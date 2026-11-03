package plgkit_test

import (
	"os"
	"strings"
	"testing"
	"time"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func TestPostgresWhenConfigured(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("PLGKIT_TEST_DATABASE_URL"))
	if url == "" {
		t.Skip("set PLGKIT_TEST_DATABASE_URL to a postgres URL")
	}
	if !strings.HasPrefix(url, "postgres://") && !strings.HasPrefix(url, "postgresql://") {
		t.Fatal("PLGKIT_TEST_DATABASE_URL must be a postgres URL")
	}
	db, err := plgkit.Connect(url)
	if err != nil {
		t.Fatal("could not open the test database")
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := plgkit.Migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := plgkit.Migrate(db); err != nil {
		t.Fatal(err)
	}
	nudge := "pgtest-go-" + time.Now().UTC().Format("20060102150405.000000000")
	plgkit.SetDefault(db)
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM plgkit_events WHERE nudge_id = $1`, nudge)
		plgkit.SetDefault(nil)
	})
	if err := plgkit.Impression(nudge, map[string]any{"user_id": "u_pg", "organization_id": "acme"}); err != nil {
		t.Fatal(err)
	}
	shown, err := plgkit.Decide("home", map[string]any{
		"user":            map[string]any{"id": "u_pg"},
		"organization_id": "acme",
	}, []map[string]any{{
		"id":              nudge,
		"location":        "home",
		"surface":         "main-top",
		"component":       "Banner",
		"render_props":    map[string]any{},
		"max_impressions": 1,
	}}, plgkit.Options{DB: db})
	if err != nil || len(shown) != 0 {
		t.Fatalf("cap %v %#v", err, shown)
	}
}
