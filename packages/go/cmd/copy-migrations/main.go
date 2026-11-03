// Command copy-migrations copies core/migrations into this package.
// core/migrations is the only schema. go:embed can only see files inside
// the module, so the package ships this copy.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func main() {
	wd, err := os.Getwd()
	if err != nil {
		exit(err)
	}
	source := filepath.Join(wd, "..", "..", "core", "migrations")
	dest := filepath.Join(wd, "migrations")
	entries, err := os.ReadDir(source)
	if err != nil {
		exit(fmt.Errorf("core/migrations was not found (%s)", source))
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		exit(err)
	}
	keep := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		if err := copyFile(filepath.Join(source, entry.Name()), filepath.Join(dest, entry.Name())); err != nil {
			exit(err)
		}
		keep[entry.Name()] = true
	}
	if len(keep) == 0 {
		exit(fmt.Errorf("no SQL files in %s", source))
	}
	old, err := os.ReadDir(dest)
	if err != nil {
		exit(err)
	}
	for _, entry := range old {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" || keep[entry.Name()] {
			continue
		}
		if err := os.Remove(filepath.Join(dest, entry.Name())); err != nil {
			exit(err)
		}
	}
}

func copyFile(source, dest string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func exit(err error) {
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}
