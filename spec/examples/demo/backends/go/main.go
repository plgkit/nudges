// Command main is the Go demo backend. Same routes as the Python and TypeScript demos.
//
// It listens on http://127.0.0.1:8787.
// The events file is spec/examples/demo/plgkit_events.sqlite.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	plgkit "github.com/plgkit/nudges/packages/go"
	"github.com/plgkit/nudges/spec/examples/go"
)

const port = "8787"
const org = "acme"

type person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

var people = map[string]person{
	"1": {ID: "1", Name: "user_one"},
	"2": {ID: "2", Name: "user_two"},
}

var byName = map[string]string{
	"user_one": "1",
	"user_two": "2",
}

var cookieID = regexp.MustCompile(`(?:^|;\s*)plgkit_demo_user=([12])(?:;|$)`)

func main() {
	demoDir, examplesDir := dirs()
	dbFile := filepath.Join(demoDir, "plgkit_events.sqlite")
	db, err := plgkit.Connect("sqlite:///" + filepath.ToSlash(dbFile))
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	plgkit.SetDefault(db)
	if err := plgkit.Migrate(db); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	config := readYAML(filepath.Join(examplesDir, "config.yml"))
	messages := loadMessages(filepath.Join(examplesDir, "messages"))
	verify := map[string]func(string, any) bool{
		"organization_id": func(userID string, value any) bool {
			_, ok := people[userID]
			return ok && value == org
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/nudges/session", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			who := currentPerson(r)
			extra := map[string]string{}
			if readCookie(r) == "" {
				extra["Set-Cookie"] = sessionCookie(who.ID)
			}
			writeJSON(w, http.StatusOK, who, extra)
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var body struct {
			User string `json:"user"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		id, ok := byName[body.User]
		if !ok {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, people[id], map[string]string{"Set-Cookie": sessionCookie(id)})
	})
	mux.HandleFunc("/api/nudges/decide", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var body struct {
			Location string         `json:"location"`
			Context  map[string]any `json:"context"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		rows, err := plgkit.Decide(body.Location, decideCtx(currentPerson(r), body.Context), messages, plgkit.Options{
			DB:        db,
			Audiences: audiences.Audiences,
			Config:    config,
		})
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows, nil)
	})
	mux.HandleFunc("/api/nudges/events", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var payload any
		if err := json.Unmarshal(raw, &payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(plgkit.HandleEvent(payload, currentPerson(r).ID, verify))
	})

	fmt.Printf("Go demo backend on http://127.0.0.1:%s\n", port)
	fmt.Printf("Events file: %s\n", dbFile)
	if err := http.ListenAndServe("127.0.0.1:"+port, mux); err != nil {
		fmt.Fprintln(os.Stderr, "Port 8787 is already in use. Stop the other backend first.")
		os.Exit(1)
	}
}

func decideCtx(who person, page map[string]any) map[string]any {
	ctx := map[string]any{
		"user": map[string]any{
			"id":                      who.ID,
			"username":                who.Name,
			"species":                 "human",
			"country_code":            "US",
			"birth_date":              "1990-04-01",
			"is_staff":                false,
			"has_active_subscription": true,
		},
	}
	if page != nil && page["organization_id"] == org {
		ctx["organization_id"] = org
	}
	return ctx
}

func currentPerson(r *http.Request) person {
	id := readCookie(r)
	if who, ok := people[id]; ok {
		return who
	}
	return people["1"]
}

func readCookie(r *http.Request) string {
	match := cookieID.FindStringSubmatch(r.Header.Get("Cookie"))
	if match == nil {
		return ""
	}
	return match[1]
}

func sessionCookie(id string) string {
	return "plgkit_demo_user=" + id + "; Path=/; SameSite=Lax"
}

func loadMessages(dir string) []map[string]any {
	entries, err := os.ReadDir(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not read messages.")
		os.Exit(1)
	}
	names := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".yml") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	var messages []map[string]any
	for _, name := range names {
		parsed := readYAML(filepath.Join(dir, name))
		if parsed == nil {
			continue
		}
		parsed["id"] = strings.TrimSuffix(name, ".yml")
		messages = append(messages, parsed)
	}
	return messages
}

func readYAML(path string) map[string]any {
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not read", path)
		os.Exit(1)
	}
	var value any
	if err := yaml.Unmarshal(raw, &value); err != nil {
		fmt.Fprintln(os.Stderr, "Could not read", path)
		os.Exit(1)
	}
	mapped, _ := normalize(value).(map[string]any)
	return mapped
}

func normalize(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			out[key] = normalize(child)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, child := range typed {
			out[i] = normalize(child)
		}
		return out
	default:
		return value
	}
}

func dirs() (string, string) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		fmt.Fprintln(os.Stderr, "Could not find the demo folder.")
		os.Exit(1)
	}
	demo := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	return demo, filepath.Dir(demo)
}

func writeJSON(w http.ResponseWriter, status int, payload any, extra map[string]string) {
	raw, err := json.Marshal(payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	for key, value := range extra {
		w.Header().Set(key, value)
	}
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
