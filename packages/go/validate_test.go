package plgkit_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func TestValidateSpecExamples(t *testing.T) {
	root := filepath.Join("..", "..", "spec", "examples")
	goRoot := t.TempDir()
	copyDir(t, filepath.Join(root, "messages"), filepath.Join(goRoot, "messages"))
	copyFile(t, filepath.Join(root, "config.yml"), filepath.Join(goRoot, "config.yml"))
	copyFile(t, filepath.Join(root, "go", "audiences.go"), filepath.Join(goRoot, "audiences.go"))

	config, messages, names, err := plgkit.LoadNudgesDir(goRoot, "audiences.go")
	if err != nil {
		t.Fatal(err)
	}
	if problems := plgkit.Validate(config, messages, names); len(problems) != 0 {
		t.Fatal(problems)
	}
}

func TestValidateUnknownAudience(t *testing.T) {
	problems := plgkit.Validate(
		map[string]any{},
		[]map[string]any{
			{
				"_path": "messages/x.yml",
				"id":    "20260101120000-test-banner",
				"audience": map[string]any{
					"require_all": []any{"missing_fn"},
				},
			},
		},
		map[string]struct{}{"is_human": {}},
	)
	if len(problems) == 0 || problems[0] == "" {
		t.Fatal(problems)
	}
}

func TestValidateSurfaceMax(t *testing.T) {
	problems := plgkit.Validate(
		map[string]any{
			"locations": map[string]any{
				"home": map[string]any{
					"max": 1,
					"surfaces": map[string]any{
						"sidebar": map[string]any{"max": 3},
					},
				},
			},
		},
		nil,
		nil,
	)
	found := false
	for _, line := range problems {
		if strings.Contains(line, "sidebar") {
			found = true
		}
	}
	if !found {
		t.Fatal(problems)
	}
}

func copyFile(t *testing.T, src, dest string) {
	t.Helper()
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func copyDir(t *testing.T, src, dest string) {
	t.Helper()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		copyFile(t, filepath.Join(src, entry.Name()), filepath.Join(dest, entry.Name()))
	}
}
