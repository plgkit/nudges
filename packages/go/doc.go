// Package plgkit saves impression, click, and dismiss events and chooses
// which messages to show. The database address lives in an environment
// variable named by database_url_env in config.yml. If that variable is
// unset, plgkit uses a SQLite file, plgkit_events.sqlite, in the current
// directory.
package plgkit
