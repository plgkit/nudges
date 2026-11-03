package plgkit_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func TestMigrateCanRunTwice(t *testing.T) {
	db := openTestDB(t)
	if err := plgkit.Migrate(db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM plgkit_schema_migrations`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("versions = %d", count)
	}
	names := map[string]bool{}
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names[name] = true
	}
	if !names["plgkit_events"] || !names["plgkit_events_user_nudge_action"] {
		t.Fatalf("names = %#v", names)
	}
}

func TestKeepsVerifiedKeysAndDropsTheRest(t *testing.T) {
	db := openTestDB(t)
	seen := map[string]any{}
	verify := map[string]func(string, any) bool{
		"organization_id": func(userID string, value any) bool {
			seen[userID+" organization_id"] = value
			return value == "acme"
		},
		"plan": func(userID string, value any) bool {
			seen[userID+" plan"] = value
			return false
		},
	}
	status := plgkit.HandleEvent(map[string]any{
		"nudge_id": "n1",
		"action":   "impression",
		"context": map[string]any{
			"organization_id": "acme",
			"plan":            "enterprise",
			"unknown":         "x",
			"user_id":         "attacker",
		},
	}, "u_123", verify)
	if status != 204 {
		t.Fatalf("status %d", status)
	}
	if seen["u_123 organization_id"] != "acme" || seen["u_123 plan"] != "enterprise" || len(seen) != 2 {
		t.Fatalf("seen %#v", seen)
	}
	got := eventRows(t, db)
	if len(got) != 1 || got[0]["user_id"] != "u_123" || got[0]["action"] != "impression" {
		t.Fatalf("%#v", got)
	}
	context := got[0]["context"].(map[string]any)
	if len(context) != 1 || context["organization_id"] != "acme" {
		t.Fatalf("context %#v", context)
	}
}

func TestVerifierPanicDropsTheKey(t *testing.T) {
	db := openTestDB(t)
	status := plgkit.HandleEvent(map[string]any{
		"nudge_id": "n1",
		"action":   "click",
		"context":  map[string]any{"organization_id": "acme"},
	}, "u_123", map[string]func(string, any) bool{
		"organization_id": func(string, any) bool { panic("nope") },
	})
	if status != 204 {
		t.Fatal(status)
	}
	got := eventRows(t, db)
	if got[0]["action"] != "click" || len(got[0]["context"].(map[string]any)) != 0 {
		t.Fatalf("%#v", got)
	}
}

func TestBadBodyWritesNothing(t *testing.T) {
	db := openTestDB(t)
	bodies := []any{
		nil,
		[]any{},
		map[string]any{},
		map[string]any{"nudge_id": "n1"},
		map[string]any{"nudge_id": "n1", "action": "nope"},
		map[string]any{"nudge_id": "", "action": "click"},
		map[string]any{"nudge_id": 1, "action": "click"},
		map[string]any{"nudge_id": "n1", "action": "click", "context": []any{"x"}},
		map[string]any{"nudge_id": "n1", "action": "click", "context": map[string]any{"organization_id": map[string]any{"nested": true}}},
	}
	for _, body := range bodies {
		if status := plgkit.HandleEvent(body, "u_123", map[string]func(string, any) bool{}); status != 400 {
			t.Fatalf("%#v -> %d", body, status)
		}
	}
	if len(eventRows(t, db)) != 0 {
		t.Fatal("wrote a row")
	}
}

func TestUndismissIsCLIOnly(t *testing.T) {
	db := openTestDB(t)
	body := map[string]any{"nudge_id": "n1", "action": "undismiss", "context": map[string]any{}}
	if plgkit.HandleEvent(body, "u_1", nil) != 400 {
		t.Fatal("status")
	}
	if len(eventRows(t, db)) != 0 {
		t.Fatal("wrote a row")
	}
}

func TestMissingUserIsIgnored(t *testing.T) {
	db := openTestDB(t)
	body := map[string]any{"nudge_id": "n1", "action": "dismiss", "context": map[string]any{"organization_id": "acme"}}
	if plgkit.HandleEvent(body, "", nil) != 204 || plgkit.HandleEvent(map[string]any{"action": "dismiss"}, "", nil) != 400 {
		t.Fatal("status")
	}
	if len(eventRows(t, db)) != 0 {
		t.Fatal("wrote a row")
	}
}

func TestContextCanBeLeftOut(t *testing.T) {
	db := openTestDB(t)
	if plgkit.HandleEvent(map[string]any{"nudge_id": "n1", "action": "dismiss"}, "u_1", nil) != 204 {
		t.Fatal("status")
	}
	if len(eventRows(t, db)[0]["context"].(map[string]any)) != 0 {
		t.Fatal("context")
	}
}

func TestDirectCallWithoutUserIDWritesNothing(t *testing.T) {
	db := openTestDB(t)
	if err := plgkit.Impression("n1", map[string]any{"organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Impression("n1", map[string]any{"user_id": "", "organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Impression("n1", nil); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Click("", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	if len(eventRows(t, db)) != 0 {
		t.Fatal("wrote a row")
	}
	if err := plgkit.Dismiss("n1", map[string]any{"user_id": "u_123", "organization_id": "acme", "nested": map[string]any{"a": 1}}); err != nil {
		t.Fatal(err)
	}
	got := eventRows(t, db)
	if got[0]["action"] != "dismiss" || got[0]["user_id"] != "u_123" {
		t.Fatalf("%#v", got)
	}
	if got[0]["context"].(map[string]any)["organization_id"] != "acme" || len(got[0]["context"].(map[string]any)) != 1 {
		t.Fatalf("%#v", got[0]["context"])
	}
}

func TestConfigRejectsAURLWithoutEchoingThePassword(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yml")
	if err := os.WriteFile(path, []byte("database_url_env: \"postgres://user:secret-password@localhost/db\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, _, err := plgkit.ResolveDatabaseURL(path, map[string]string{})
	if err == nil || strings.Contains(err.Error(), "secret-password") || !strings.Contains(err.Error(), "environment variable") {
		t.Fatal(err)
	}
	url, usedDefault, err := plgkit.ResolveDatabaseURL("", map[string]string{
		"PLGKIT_DATABASE_URL": "postgresql://user:secret-password@localhost/db",
	})
	if err != nil || usedDefault || !strings.HasPrefix(url, "postgresql://") {
		t.Fatal("postgres URL should be accepted")
	}
	_, _, err = plgkit.ResolveDatabaseURL("", map[string]string{
		"PLGKIT_DATABASE_URL": "mysql://user:secret-password@localhost/db",
	})
	if err == nil || strings.Contains(err.Error(), "secret-password") || strings.Contains(err.Error(), "mysql://") || !strings.Contains(err.Error(), "mysql") {
		t.Fatal("mysql error leaked or was unclear")
	}
	_, err = plgkit.Connect("postgres://user:secret-password@127.0.0.1:1/db")
	if err == nil || strings.Contains(err.Error(), "secret-password") || strings.Contains(err.Error(), "postgres://") {
		t.Fatal("connect error leaked the URL")
	}
}

func TestUnsetEnvUsesTheSQLiteFile(t *testing.T) {
	url, usedDefault, err := plgkit.ResolveDatabaseURL("", map[string]string{})
	if err != nil || !usedDefault || url != "sqlite:///plgkit_events.sqlite" {
		t.Fatalf("%s %v %v", url, usedDefault, err)
	}
}

func TestHTTPHandler(t *testing.T) {
	db := openTestDB(t)
	verify := map[string]func(string, any) bool{
		"organization_id": func(string, any) bool { return true },
	}
	handler := plgkit.Handler(verify, func(*http.Request) string { return "u_123" })
	req := httptest.NewRequest(http.MethodPost, "/api/nudges/events", strings.NewReader(`{"nudge_id":"n1","action":"impression","context":{"organization_id":"acme","nope":"x","user_id":"attacker"}}`))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("post %d", rec.Code)
	}
	got := eventRows(t, db)
	if len(got) != 1 || got[0]["user_id"] != "u_123" || got[0]["action"] != "impression" {
		t.Fatalf("%#v", got)
	}
	if got[0]["context"].(map[string]any)["organization_id"] != "acme" || len(got[0]["context"].(map[string]any)) != 1 {
		t.Fatalf("%#v", got[0]["context"])
	}
	get := httptest.NewRequest(http.MethodGet, "/api/nudges/events", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, get)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("get %d", rec.Code)
	}
	bad := httptest.NewRequest(http.MethodPost, "/api/nudges/events", strings.NewReader(`not json`))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, bad)
	if rec.Code != 400 {
		t.Fatalf("bad %d", rec.Code)
	}
}
