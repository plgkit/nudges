package main

import (
	"fmt"
	"os"

	plgkit "github.com/plgkit/nudges/packages/go"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		fmt.Fprintln(os.Stderr, "Usage: plgkit migrate")
		if len(args) == 0 {
			return 1
		}
		return 0
	}
	if args[0] != "migrate" {
		fmt.Fprintf(os.Stderr, "Unknown command: %s\nUsage: plgkit migrate\n", args[0])
		return 1
	}
	if err := plgkit.Migrate(nil); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		return 1
	}
	fmt.Println("Migrations are up to date.")
	return 0
}
