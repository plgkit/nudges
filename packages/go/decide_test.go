package plgkit_test

import (
	"database/sql"
	"testing"
	"time"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func testMessage(overrides map[string]any) map[string]any {
	message := map[string]any{
		"id":        "banner",
		"location":  "home",
		"surface":   "main-top",
		"component": "Banner",
		"render_props": map[string]any{
			"asset": "banner.png",
			"slides": []any{
				map[string]any{"asset": "slide.png"},
				map[string]any{"asset": "https://cdn.example/a.png"},
				map[string]any{"asset": "/abs.png"},
			},
		},
		"max_impressions": 2,
	}
	for key, value := range overrides {
		if value == nil {
			delete(message, key)
			continue
		}
		message[key] = value
	}
	return message
}

func testCtx(overrides map[string]any) map[string]any {
	ctx := map[string]any{
		"user":            map[string]any{"id": "u_123"},
		"organization_id": "acme",
	}
	for key, value := range overrides {
		if value == nil {
			delete(ctx, key)
			continue
		}
		ctx[key] = value
	}
	return ctx
}

func testConfig() map[string]any {
	return map[string]any{
		"assets_base_url": "/static/nudges/",
		"locations": map[string]any{
			"home": map[string]any{
				"max": 2,
				"surfaces": map[string]any{
					"main-top": map[string]any{"max": 2},
				},
			},
		},
	}
}

func idsOf(t *testing.T, decisions []map[string]any) []string {
	t.Helper()
	ids := []string{}
	for _, item := range decisions {
		ids = append(ids, item["id"].(string))
	}
	return ids
}

func TestMaxImpressions(t *testing.T) {
	db := openTestDB(t)
	banner := testMessage(nil)
	if err := plgkit.Impression("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Impression("banner", map[string]any{"user_id": "someone_else"}); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Click("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	var before int
	if err := db.QueryRow(`SELECT COUNT(*) FROM plgkit_events`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	shown, err := plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, plgkit.Options{DB: db, Config: testConfig()})
	if err != nil {
		t.Fatal(err)
	}
	var after int
	if err := db.QueryRow(`SELECT COUNT(*) FROM plgkit_events`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("decide wrote a row")
	}
	if stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("%#v", shown)
	}
	props := shown[0]["render_props"].(map[string]any)
	if props["asset"] != "/static/nudges/banner.png" {
		t.Fatal(props["asset"])
	}
	slides := props["slides"].([]any)
	if slides[0].(map[string]any)["asset"] != "/static/nudges/slide.png" ||
		slides[1].(map[string]any)["asset"] != "https://cdn.example/a.png" ||
		slides[2].(map[string]any)["asset"] != "/abs.png" {
		t.Fatalf("%#v", slides)
	}
	if banner["render_props"].(map[string]any)["asset"] != "banner.png" {
		t.Fatal("mutated the message")
	}
	if err := plgkit.Impression("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, plgkit.Options{DB: db, Config: testConfig()})
	if err != nil || len(shown) != 0 {
		t.Fatalf("%v %#v", err, shown)
	}
	unlimited := testMessage(map[string]any{"max_impressions": nil})
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{unlimited}, plgkit.Options{DB: db, Config: testConfig()})
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("%v %#v", err, shown)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{testMessage(map[string]any{"max_impressions": 0})}, plgkit.Options{DB: db, Config: testConfig()})
	if err != nil || len(shown) != 0 {
		t.Fatalf("zero cap %v %#v", err, shown)
	}
}

func TestDismissScope(t *testing.T) {
	db := openTestDB(t)
	opts := plgkit.Options{DB: db, Config: testConfig()}
	banner := testMessage(map[string]any{"max_impressions": nil})
	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123", "organization_id": "other"}); err != nil {
		t.Fatal(err)
	}
	shown, err := plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatalf("any dismiss %#v %v", shown, err)
	}
	clearEvents(t, db)

	scoped := testMessage(map[string]any{"max_impressions": nil, "dismiss_scope": []string{"organization_id"}})
	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123", "organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{scoped}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatal("matching scope should hide")
	}
	shown, err = plgkit.Decide("home", testCtx(map[string]any{"organization_id": "other"}), []map[string]any{scoped}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("other org %#v %v", shown, err)
	}
	clearEvents(t, db)

	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{scoped}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("row missing key %#v %v", shown, err)
	}
	clearEvents(t, db)

	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123", "organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(map[string]any{"organization_id": nil}), []map[string]any{scoped}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("ctx missing key %#v %v", shown, err)
	}
	clearEvents(t, db)

	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "other-user", "organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Dismiss("other-nudge", map[string]any{"user_id": "u_123", "organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{scoped}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("other user or nudge %#v %v", shown, err)
	}

	both := testMessage(map[string]any{"max_impressions": nil, "dismiss_scope": []string{"organization_id", "plan"}})
	clearEvents(t, db)
	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123", "organization_id": "acme", "plan": "pro"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(map[string]any{"plan": "pro"}), []map[string]any{both}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatal("both keys should hide")
	}
	shown, err = plgkit.Decide("home", testCtx(map[string]any{"plan": "free"}), []map[string]any{both}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("plan differs %#v %v", shown, err)
	}
}

func TestUndismissResetsImpressions(t *testing.T) {
	db := openTestDB(t)
	opts := plgkit.Options{DB: db, Config: testConfig()}
	banner := testMessage(map[string]any{"max_impressions": 2})
	if err := plgkit.Impression("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Impression("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err := plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatalf("cap reached %#v %v", shown, err)
	}
	if err := plgkit.Undismiss("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("undismiss should reset impressions %#v %v", shown, err)
	}
}

func TestUndismissCycle(t *testing.T) {
	db := openTestDB(t)
	opts := plgkit.Options{DB: db, Config: testConfig()}
	banner := testMessage(map[string]any{"max_impressions": nil})
	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err := plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatalf("dismiss should hide %#v %v", shown, err)
	}
	if err := plgkit.Undismiss("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("undismiss should show %#v %v", shown, err)
	}
	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{banner}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatalf("dismiss again should hide %#v %v", shown, err)
	}
}

func TestActiveWindowAndUnknownAudience(t *testing.T) {
	db := openTestDB(t)
	opts := plgkit.Options{DB: db, Config: testConfig()}
	window := testMessage(map[string]any{
		"max_impressions": nil,
		"active":          map[string]any{"from": "2026-10-30", "to": "2026-11-01"},
	})
	start := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	opts.Now = start
	shown, err := plgkit.Decide("home", testCtx(nil), []map[string]any{window}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("from %#v %v", shown, err)
	}
	opts.Now = end
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{window}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatalf("to %#v %v", shown, err)
	}
	unknown := testMessage(map[string]any{
		"max_impressions": nil,
		"audience":        map[string]any{"require_all": []string{"missing_fn"}},
	})
	opts.Now = time.Time{}
	opts.Audiences = map[string]func(map[string]any) bool{}
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{unknown}, opts)
	if err != nil || len(shown) != 0 {
		t.Fatalf("unknown %#v %v", shown, err)
	}
	open := testMessage(map[string]any{"max_impressions": nil})
	shown, err = plgkit.Decide("home", testCtx(nil), []map[string]any{open}, opts)
	if err != nil || stringsEqual(idsOf(t, shown), []string{"banner"}) == false {
		t.Fatalf("everyone %#v %v", shown, err)
	}
}

func clearEvents(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`DELETE FROM plgkit_events`); err != nil {
		t.Fatal(err)
	}
}

func stringsEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
