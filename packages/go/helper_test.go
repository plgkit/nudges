package plgkit_test

import (
	"database/sql"
	"encoding/json"
	"testing"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := plgkit.Connect("sqlite:///:memory:")
	if err != nil {
		t.Fatal(err)
	}
	plgkit.SetDefault(db)
	t.Cleanup(func() {
		plgkit.SetDefault(nil)
		_ = db.Close()
	})
	if err := plgkit.Migrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func eventRows(t *testing.T, db *sql.DB) []map[string]any {
	t.Helper()
	rows, err := db.Query(`SELECT nudge_id, action, user_id, context FROM plgkit_events ORDER BY rowid`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var found []map[string]any
	for rows.Next() {
		var nudgeID, action, userID, raw string
		if err := rows.Scan(&nudgeID, &action, &userID, &raw); err != nil {
			t.Fatal(err)
		}
		var context map[string]any
		if err := json.Unmarshal([]byte(raw), &context); err != nil {
			t.Fatal(err)
		}
		found = append(found, map[string]any{
			"nudge_id": nudgeID,
			"action":   action,
			"user_id":  userID,
			"context":  context,
		})
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if found == nil {
		found = []map[string]any{}
	}
	return found
}
