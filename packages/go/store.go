package plgkit

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

const (
	DefaultDatabaseURLEnv = "PLGKIT_DATABASE_URL"
	DefaultDatabaseURL    = "sqlite:///plgkit_events.sqlite"
	maxExactInt           = 9007199254740992
)

var (
	envNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	migrationName  = regexp.MustCompile(`^(\d+)_.+\.sql$`)
	mu             sync.Mutex
	warnMu         sync.Mutex
	defaultDB      *sql.DB
	warnedDefault  bool
)

// Error is a problem the developer should read, such as a bad database setting.
type Error struct{ Msg string }

func (e *Error) Error() string { return e.Msg }

func fail(msg string) error { return &Error{Msg: msg} }

// ResolveDatabaseURL returns the SQLite URL and whether it is the local default.
// environ == nil reads the process environment. A non-nil map is used instead,
// including when it is empty. Error text never includes the URL.
func ResolveDatabaseURL(configPath string, environ map[string]string) (string, bool, error) {
	name, err := envVarName(configPath)
	if err != nil {
		return "", false, err
	}
	var value string
	if environ == nil {
		value = os.Getenv(name)
	} else {
		value = environ[name]
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return DefaultDatabaseURL, true, nil
	}
	if strings.HasPrefix(value, "sqlite:") {
		return value, false, nil
	}
	scheme := "unknown"
	if i := strings.Index(value, "://"); i >= 0 {
		scheme = value[:i]
	}
	return "", false, fail(fmt.Sprintf(
		"%s uses the %q scheme. This version of plgkit supports SQLite only, for example sqlite:///plgkit_events.sqlite. Unset the variable to use the local SQLite file.",
		name, scheme,
	))
}

// Connect opens SQLite. An empty url reads config and the environment.
func Connect(url string) (*sql.DB, error) {
	if url == "" {
		resolved, usedDefault, err := ResolveDatabaseURL("", nil)
		if err != nil {
			return nil, err
		}
		if usedDefault {
			warnDefault()
		}
		url = resolved
	}
	path, err := sqlitePath(url)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fail("Could not open the SQLite database.")
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err := db.Exec("PRAGMA busy_timeout = 5000"); err != nil {
		_ = db.Close()
		return nil, fail("Could not open the SQLite database.")
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fail("Could not open the SQLite database.")
	}
	return db, nil
}

// SetDefault pins the connection used by Impression, Click, Dismiss, and HandleEvent.
func SetDefault(db *sql.DB) {
	mu.Lock()
	defer mu.Unlock()
	defaultDB = db
}

// Migrate creates the events table. Safe to run again. A nil db uses the default connection.
func Migrate(db *sql.DB) error {
	mu.Lock()
	defer mu.Unlock()
	if db == nil {
		var err error
		db, err = openDefaultLocked()
		if err != nil {
			return err
		}
	}
	return migrateLocked(db, "")
}

// Impression appends one impression. A missing user_id is ignored.
func Impression(nudgeID string, event map[string]any) error {
	return record("impression", nudgeID, event, nil)
}

// Click appends one click. A missing user_id is ignored.
func Click(nudgeID string, event map[string]any) error {
	return record("click", nudgeID, event, nil)
}

// Dismiss appends one dismiss. A missing user_id is ignored.
func Dismiss(nudgeID string, event map[string]any) error {
	return record("dismiss", nudgeID, event, nil)
}

func record(action, nudgeID string, event map[string]any, db *sql.DB) error {
	if nudgeID == "" || event == nil {
		return nil
	}
	userID, _ := event["user_id"].(string)
	if userID == "" {
		return nil
	}
	context := map[string]any{}
	for key, value := range event {
		if key == "user_id" {
			continue
		}
		cleaned, ok := canon(value)
		if ok {
			context[key] = cleaned
		}
	}
	raw, err := marshalContext(context)
	if err != nil {
		return fail("Could not save the event.")
	}
	mu.Lock()
	defer mu.Unlock()
	if db == nil {
		db, err = openDefaultLocked()
		if err != nil {
			return err
		}
	}
	_, err = db.Exec(
		`INSERT INTO plgkit_events (id, nudge_id, action, user_id, context, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		newID(), nudgeID, action, userID, raw, time.Now().UTC().Format("2006-01-02T15:04:05.000000Z"),
	)
	if err != nil {
		return fail("Could not save the event.")
	}
	return nil
}

func countImpressions(db *sql.DB, userID, nudgeID string) (int, error) {
	mu.Lock()
	defer mu.Unlock()
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM plgkit_events WHERE user_id = ? AND nudge_id = ? AND action = 'impression'`,
		userID, nudgeID,
	).Scan(&n)
	if err != nil {
		return 0, fail("Could not read events.")
	}
	return n, nil
}

func dismissContexts(db *sql.DB, userID, nudgeID string) ([]map[string]any, error) {
	mu.Lock()
	defer mu.Unlock()
	rows, err := db.Query(
		`SELECT context FROM plgkit_events WHERE user_id = ? AND nudge_id = ? AND action = 'dismiss'`,
		userID, nudgeID,
	)
	if err != nil {
		return nil, fail("Could not read events.")
	}
	defer rows.Close()
	var found []map[string]any
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, fail("Could not read events.")
		}
		var data map[string]any
		if err := json.Unmarshal([]byte(raw), &data); err != nil || data == nil {
			continue
		}
		found = append(found, data)
	}
	if err := rows.Err(); err != nil {
		return nil, fail("Could not read events.")
	}
	return found, nil
}

func migrateLocked(db *sql.DB, dir string) error {
	files, err := loadMigrations(dir)
	if err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS plgkit_schema_migrations (version TEXT PRIMARY KEY)`); err != nil {
		return fail("Could not prepare migrations.")
	}
	applied := map[string]bool{}
	rows, err := db.Query(`SELECT version FROM plgkit_schema_migrations`)
	if err != nil {
		return fail("Could not prepare migrations.")
	}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			rows.Close()
			return fail("Could not prepare migrations.")
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fail("Could not prepare migrations.")
	}
	rows.Close()

	for _, file := range files {
		if applied[file.version] {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return fail("Migration " + file.version + " failed.")
		}
		for _, statement := range sqlStatements(file.sql) {
			if _, err := tx.Exec(statement); err != nil {
				_ = tx.Rollback()
				return fail("Migration " + file.version + " failed.")
			}
		}
		if _, err := tx.Exec(`INSERT INTO plgkit_schema_migrations (version) VALUES (?)`, file.version); err != nil {
			_ = tx.Rollback()
			return fail("Migration " + file.version + " failed.")
		}
		if err := tx.Commit(); err != nil {
			return fail("Migration " + file.version + " failed.")
		}
	}
	return nil
}

func openDefaultLocked() (*sql.DB, error) {
	if defaultDB != nil {
		return defaultDB, nil
	}
	db, err := connectUnlocked()
	if err != nil {
		return nil, err
	}
	defaultDB = db
	return db, nil
}

func connectUnlocked() (*sql.DB, error) {
	// Called with mu held. Connect takes no lock, but it may warn.
	return Connect("")
}

type migrationSource struct {
	version string
	sql     string
}

func loadMigrations(dir string) ([]migrationSource, error) {
	if strings.TrimSpace(dir) == "" {
		dir = strings.TrimSpace(os.Getenv("PLGKIT_MIGRATIONS_DIR"))
	}
	if dir != "" {
		return migrationsFromDir(dir)
	}
	return migrationsFromEmbed()
}

func migrationsFromDir(dir string) ([]migrationSource, error) {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil, fail("Migrations folder does not exist: " + dir)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fail("Could not read migrations.")
	}
	var found []migrationSource
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			continue
		}
		text, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, fail("Could not read migration " + match[1] + ".")
		}
		found = append(found, migrationSource{version: match[1], sql: string(text)})
	}
	return sortMigrations(found)
}

func migrationsFromEmbed() ([]migrationSource, error) {
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return nil, fail("The plgkit package is missing its migration files. Rebuild the package.")
	}
	var found []migrationSource
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			continue
		}
		text, err := migrationFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return nil, fail("Could not read migration " + match[1] + ".")
		}
		found = append(found, migrationSource{version: match[1], sql: string(text)})
	}
	return sortMigrations(found)
}

func sortMigrations(found []migrationSource) ([]migrationSource, error) {
	sort.Slice(found, func(i, j int) bool {
		a, _ := strconv.Atoi(found[i].version)
		b, _ := strconv.Atoi(found[j].version)
		return a < b
	})
	if len(found) == 0 {
		return nil, fail("No migration files found.")
	}
	return found, nil
}

func envVarName(configPath string) (string, error) {
	path := configPath
	if path == "" {
		candidate := filepath.Join("plgkit", "nudges", "config.yml")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			path = candidate
		}
	}
	if path == "" {
		return DefaultDatabaseURLEnv, nil
	}
	text, err := os.ReadFile(path)
	if err != nil {
		return "", fail("Could not read config file: " + path)
	}
	name, ok, err := parseDatabaseURLEnv(string(text))
	if err != nil {
		return "", err
	}
	if !ok {
		return DefaultDatabaseURLEnv, nil
	}
	if !envNamePattern.MatchString(name) {
		return "", fail("database_url_env in config.yml must be the name of an environment variable, not the database address. The address can contain a password, so put it in the environment. Example: database_url_env: PLGKIT_DATABASE_URL")
	}
	return name, nil
}

func parseDatabaseURLEnv(text string) (string, bool, error) {
	var found []string
	for _, raw := range strings.Split(text, "\n") {
		raw = strings.TrimRight(raw, "\r")
		if strings.HasPrefix(raw, " ") || strings.HasPrefix(raw, "\t") {
			continue
		}
		line := raw
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "database_url_env:") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(line, "database_url_env:"))
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		found = append(found, value)
	}
	if len(found) == 0 {
		return "", false, nil
	}
	if len(found) > 1 {
		return "", false, fail("database_url_env is set more than once in config.yml.")
	}
	return found[0], true, nil
}

func sqlitePath(url string) (string, error) {
	if url == "sqlite:///:memory:" || url == "sqlite::memory:" {
		return ":memory:", nil
	}
	const prefix = "sqlite:///"
	if !strings.HasPrefix(url, prefix) {
		return "", fail("The SQLite URL must look like sqlite:///plgkit_events.sqlite or sqlite:///:memory:.")
	}
	return strings.TrimPrefix(url, prefix), nil
}

func sqlStatements(text string) []string {
	var b strings.Builder
	for _, line := range strings.Split(text, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	var out []string
	for _, part := range strings.Split(b.String(), ";") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func marshalContext(value map[string]any) (string, error) {
	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(value); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

func canon(value any) (any, bool) {
	switch value.(type) {
	case nil:
		return nil, true
	case string:
		return value, true
	case bool:
		return value, true
	}
	if i, ok := asInt(value); ok {
		return i, true
	}
	switch n := value.(type) {
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, false
		}
		return n, true
	case json.Number:
		f, err := n.Float64()
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, false
		}
		if i, ok := asInt(f); ok {
			return i, true
		}
		return f, true
	default:
		return nil, false
	}
}

func asInt(value any) (int, bool) {
	switch n := value.(type) {
	case int:
		return n, true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || math.Abs(n) > maxExactInt {
			return 0, false
		}
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 0, false
		}
		return int(i), true
	default:
		return 0, false
	}
}

func sameValue(left, right any) bool {
	a, aok := canon(left)
	b, bok := canon(right)
	if !aok || !bok {
		return false
	}
	return a == b
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func warnDefault() {
	warnMu.Lock()
	defer warnMu.Unlock()
	if warnedDefault {
		return
	}
	warnedDefault = true
	name, err := envVarName("")
	if err != nil || name == "" {
		name = DefaultDatabaseURLEnv
	}
	fmt.Fprintf(os.Stderr, "%s is unset. Using a SQLite file at plgkit_events.sqlite in the current directory.\n", name)
}
