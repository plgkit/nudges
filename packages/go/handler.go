package plgkit

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
)

// HandleEvent checks a parsed JSON body and appends one row.
// body is {nudge_id, action, context}. userID comes from the session.
// A user_id inside context is ignored. verify maps a context key to
// func(userID, value) bool. Keys with no function, or a function that is not
// true, are dropped. Returns 204 or 400. A database failure returns 500.
func HandleEvent(body any, userID string, verify map[string]func(string, any) bool) int {
	nudgeID, action, context, ok := parseBody(body)
	if !ok {
		return http.StatusBadRequest
	}
	if userID == "" {
		return http.StatusNoContent
	}
	verified := map[string]any{}
	keys := make([]string, 0, len(context))
	for key := range context {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fn := verify[key]
		if fn == nil {
			continue
		}
		if safeVerify(fn, userID, context[key]) {
			verified[key] = context[key]
		}
	}
	event := map[string]any{"user_id": userID}
	for key, value := range verified {
		event[key] = value
	}
	var err error
	switch action {
	case "impression":
		err = Impression(nudgeID, event)
	case "click":
		err = Click(nudgeID, event)
	case "dismiss":
		err = Dismiss(nudgeID, event)
	default:
		return http.StatusBadRequest
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "plgkit: could not save the event.")
		return http.StatusInternalServerError
	}
	return http.StatusNoContent
}

// Handler is a net/http handler. userID reads the signed-in user from the request.
func Handler(verify map[string]func(string, any) bool, userID func(*http.Request) string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		defer r.Body.Close()
		payload, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var parsed any
		if err := json.Unmarshal(payload, &parsed); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		uid := ""
		if userID != nil {
			uid = userID(r)
		}
		w.WriteHeader(HandleEvent(parsed, uid, verify))
	})
}

func parseBody(body any) (string, string, map[string]any, bool) {
	object, ok := body.(map[string]any)
	if !ok {
		return "", "", nil, false
	}
	nudgeID, ok := object["nudge_id"].(string)
	if !ok || nudgeID == "" {
		return "", "", nil, false
	}
	action, ok := object["action"].(string)
	if !ok || (action != "impression" && action != "click" && action != "dismiss") {
		return "", "", nil, false
	}
	raw, present := object["context"]
	if present && raw == nil {
		raw = map[string]any{}
	}
	if !present {
		raw = map[string]any{}
	}
	rawContext, ok := raw.(map[string]any)
	if !ok {
		return "", "", nil, false
	}
	context := map[string]any{}
	for key, value := range rawContext {
		if key == "user_id" {
			continue
		}
		cleaned, good := canon(value)
		if !good {
			return "", "", nil, false
		}
		context[key] = cleaned
	}
	return nudgeID, action, context, true
}

func safeVerify(fn func(string, any) bool, userID string, value any) (ok bool) {
	defer func() { _ = recover() }()
	return fn(userID, value)
}
