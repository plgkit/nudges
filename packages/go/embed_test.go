package plgkit

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestEmbeddedMigrationsMatchCoreAndApply(t *testing.T) {
	t.Setenv("PLGKIT_MIGRATIONS_DIR", "")
	coreDir := filepath.Join("..", "..", "core", "migrations")
	coreEntries, err := os.ReadDir(coreDir)
	if err != nil {
		t.Fatal(err)
	}
	var coreSQL []string
	for _, entry := range coreEntries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		coreSQL = append(coreSQL, entry.Name())
		embedded, err := migrationFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			t.Fatalf("package is missing %s: %v", entry.Name(), err)
		}
		original, err := os.ReadFile(filepath.Join(coreDir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(embedded, original) {
			t.Fatalf("%s in the package does not match core/migrations", entry.Name())
		}
	}
	embeddedEntries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	var embeddedSQL []string
	for _, entry := range embeddedEntries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".sql" {
			embeddedSQL = append(embeddedSQL, entry.Name())
		}
	}
	if len(embeddedSQL) != len(coreSQL) {
		t.Fatalf("package has %v, core has %v", embeddedSQL, coreSQL)
	}

	db, err := Connect("sqlite:///:memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	var name string
	err = db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plgkit_events'`).Scan(&name)
	if err != nil {
		t.Fatal(err)
	}
	if name != "plgkit_events" {
		t.Fatal(name)
	}
}
