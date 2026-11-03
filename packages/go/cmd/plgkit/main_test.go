package main

import (
	"os"
	"path/filepath"
	"testing"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func TestRunMigrate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "events.sqlite")
	t.Setenv("PLGKIT_DATABASE_URL", "sqlite:///"+path)
	plgkit.SetDefault(nil)
	t.Cleanup(func() { plgkit.SetDefault(nil) })
	if code := run([]string{"migrate"}); code != 0 {
		t.Fatal(code)
	}
	if code := run([]string{"migrate"}); code != 0 {
		t.Fatal(code)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestRunUndismiss(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "events.sqlite")
	t.Setenv("PLGKIT_DATABASE_URL", "sqlite:///"+path)
	plgkit.SetDefault(nil)
	t.Cleanup(func() { plgkit.SetDefault(nil) })
	if code := run([]string{"migrate"}); code != 0 {
		t.Fatal(code)
	}
	if err := plgkit.Dismiss("banner", map[string]any{"user_id": "u_123"}); err != nil {
		t.Fatal(err)
	}
	if code := run([]string{"undismiss", "banner", "--user", "u_123"}); code != 0 {
		t.Fatal(code)
	}
}
