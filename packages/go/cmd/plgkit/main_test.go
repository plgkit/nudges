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

func TestRunValidateExamples(t *testing.T) {
	examples := filepath.Join("..", "..", "..", "..", "spec", "examples")
	dir := t.TempDir()
	copyValidateFixture(t, filepath.Join(examples, "messages"), filepath.Join(dir, "messages"))
	copyValidateFile(t, filepath.Join(examples, "config.yml"), filepath.Join(dir, "config.yml"))
	copyValidateFile(t, filepath.Join(examples, "go", "audiences.go"), filepath.Join(dir, "audiences.go"))
	if code := run([]string{"validate", dir}); code != 0 {
		t.Fatal(code)
	}
}

func copyValidateFile(t *testing.T, src, dest string) {
	t.Helper()
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func copyValidateFixture(t *testing.T, src, dest string) {
	t.Helper()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		copyValidateFile(t, filepath.Join(src, entry.Name()), filepath.Join(dest, entry.Name()))
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
