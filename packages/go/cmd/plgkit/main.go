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
		usage()
		if len(args) == 0 {
			return 1
		}
		return 0
	}
	switch args[0] {
	case "migrate":
		if err := plgkit.Migrate(nil); err != nil {
			fmt.Fprintln(os.Stderr, err.Error())
			return 1
		}
		fmt.Println("Migrations are up to date.")
		return 0
	case "undismiss":
		return runUndismiss(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", args[0])
		usage()
		return 1
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "Usage: plgkit migrate")
	fmt.Fprintln(os.Stderr, "       plgkit undismiss <nudge_id> --user <user_id>")
}

func runUndismiss(args []string) int {
	if len(args) < 1 {
		usage()
		return 1
	}
	nudgeID := args[0]
	userID := ""
	for i := 1; i < len(args); i++ {
		if args[i] == "--user" {
			if i+1 >= len(args) {
				fmt.Fprintln(os.Stderr, "Missing value for --user.")
				return 1
			}
			userID = args[i+1]
			i++
			continue
		}
		fmt.Fprintf(os.Stderr, "Unknown argument: %s\n", args[i])
		usage()
		return 1
	}
	if nudgeID == "" || userID == "" {
		if userID == "" {
			fmt.Fprintln(os.Stderr, "--user is required.")
		}
		usage()
		return 1
	}
	if err := plgkit.Undismiss(nudgeID, map[string]any{"user_id": userID}); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		return 1
	}
	return 0
}
