package plgkit

import (
	"database/sql"
	"sort"
	"strings"
	"time"
)

// Options are the extra inputs to Decide. Zero values are fine.
type Options struct {
	DB        *sql.DB
	Audiences map[string]func(any) bool
	Config    map[string]any
	Now       time.Time
}

// Decide returns the winners for one location. messages are the ones you already
// loaded. user id is read from ctx["user"]["id"]. Decide only reads the events table.
func Decide(location string, ctx any, messages []map[string]any, opts Options) ([]map[string]any, error) {
	if location == "" || len(messages) == 0 {
		return []map[string]any{}, nil
	}
	db := opts.DB
	if db == nil {
		var err error
		mu.Lock()
		db, err = openDefaultLocked()
		mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
	moment := opts.Now.UTC()
	if opts.Now.IsZero() {
		moment = time.Now().UTC()
	}
	settings := opts.Config
	var locations map[string]any
	if settings != nil {
		locations, _ = settings["locations"].(map[string]any)
	}
	var loc map[string]any
	if locations != nil {
		loc, _ = locations[location].(map[string]any)
	}
	locationLimit := limitOf(loc, 1)
	var surfaces map[string]any
	if loc != nil {
		surfaces, _ = loc["surfaces"].(map[string]any)
	}
	base := ""
	if settings != nil {
		base, _ = settings["assets_base_url"].(string)
	}
	userID := userIDOf(ctx)

	var candidates []map[string]any
	for _, message := range messages {
		if !messageOK(message) {
			continue
		}
		if message["location"] != location {
			continue
		}
		if !isActive(message, moment) {
			continue
		}
		dismissed, err := isDismissed(db, userID, message, ctx)
		if err != nil {
			return nil, err
		}
		if dismissed {
			continue
		}
		under, err := underMaxImpressions(db, userID, message)
		if err != nil {
			return nil, err
		}
		if !under {
			continue
		}
		if !audienceMatches(message, ctx, opts.Audiences) {
			continue
		}
		candidates = append(candidates, message)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		pi, pj := priorityOf(candidates[i]), priorityOf(candidates[j])
		if pi != pj {
			return pi < pj
		}
		return candidates[i]["id"].(string) < candidates[j]["id"].(string)
	})

	winners := []map[string]any{}
	perSurface := map[string]int{}
	for _, message := range candidates {
		if len(winners) >= locationLimit {
			break
		}
		surface := message["surface"].(string)
		var surfaceCfg any
		if surfaces != nil {
			surfaceCfg = surfaces[surface]
		}
		if perSurface[surface] >= limitOf(surfaceCfg, 1) {
			continue
		}
		winners = append(winners, message)
		perSurface[surface]++
	}
	out := make([]map[string]any, 0, len(winners))
	for _, message := range winners {
		props, _ := message["render_props"].(map[string]any)
		out = append(out, map[string]any{
			"id":           message["id"],
			"surface":      message["surface"],
			"component":    message["component"],
			"render_props": resolveAssets(props, base),
		})
	}
	return out, nil
}

func userIDOf(ctx any) string {
	user, ok := lookup(ctx, "user")
	if !ok {
		return ""
	}
	id, ok := lookup(user, "id")
	if !ok {
		return ""
	}
	text, ok := id.(string)
	if !ok {
		return ""
	}
	return text
}

func lookup(obj any, key string) (any, bool) {
	m, ok := obj.(map[string]any)
	if !ok {
		return nil, false
	}
	value, ok := m[key]
	return value, ok
}

func isDismissed(db *sql.DB, userID string, message map[string]any, ctx any) (bool, error) {
	// No dismiss_scope: any dismiss row for this user and nudge matches.
	// With dismiss_scope: every listed key must be on ctx and on the row, with
	// equal values. A row missing a scoped key does not match. If ctx is missing
	// a scoped key, no row matches, so the message can show.
	if userID == "" {
		return false, nil
	}
	rows, err := dismissContexts(db, userID, message["id"].(string))
	if err != nil {
		return false, err
	}
	scopeRaw, hasScope := message["dismiss_scope"]
	if !hasScope || scopeRaw == nil {
		return len(rows) > 0, nil
	}
	scope, ok := stringList(scopeRaw)
	if !ok {
		return false, nil
	}
	ctxValues := map[string]any{}
	for _, key := range scope {
		value, found := lookup(ctx, key)
		if !found {
			return false, nil
		}
		ctxValues[key] = value
	}
	for _, row := range rows {
		if rowMatches(row, scope, ctxValues) {
			return true, nil
		}
	}
	return false, nil
}

func rowMatches(row map[string]any, scope []string, ctxValues map[string]any) bool {
	for _, key := range scope {
		value, ok := row[key]
		if !ok || !sameValue(value, ctxValues[key]) {
			return false
		}
	}
	return true
}

func underMaxImpressions(db *sql.DB, userID string, message map[string]any) (bool, error) {
	raw, ok := message["max_impressions"]
	if !ok || raw == nil {
		return true, nil
	}
	cap, ok := asInt(raw)
	if !ok {
		return false, nil
	}
	if userID == "" {
		return true, nil
	}
	count, err := countImpressions(db, userID, message["id"].(string))
	if err != nil {
		return false, err
	}
	return count < cap, nil
}

func messageOK(message map[string]any) bool {
	if message == nil {
		return false
	}
	if !nonEmptyString(message["id"]) || !nonEmptyString(message["surface"]) || !nonEmptyString(message["component"]) {
		return false
	}
	if _, ok := message["render_props"].(map[string]any); !ok {
		return false
	}
	if raw, ok := message["max_impressions"]; ok && raw != nil {
		cap, good := asInt(raw)
		if !good || cap < 0 {
			return false
		}
	}
	if raw, ok := message["dismiss_scope"]; ok && raw != nil {
		if _, good := stringList(raw); !good {
			return false
		}
	}
	if raw, ok := message["priority"]; ok && raw != nil {
		if _, good := asInt(raw); !good {
			return false
		}
	}
	if raw, ok := message["active"]; ok && raw != nil {
		if _, good := raw.(map[string]any); !good {
			return false
		}
	}
	if raw, ok := message["audience"]; ok && raw != nil {
		if _, good := raw.(map[string]any); !good {
			return false
		}
	}
	return true
}

func isActive(message map[string]any, now time.Time) bool {
	raw, ok := message["active"]
	if !ok || raw == nil {
		return true
	}
	active, ok := raw.(map[string]any)
	if !ok {
		return false
	}
	if from, ok := active["from"]; ok && from != nil {
		start, good := parseTime(from)
		if !good || now.Before(start) {
			return false
		}
	}
	if to, ok := active["to"]; ok && to != nil {
		end, good := parseTime(to)
		if !good || !now.Before(end) {
			return false
		}
	}
	return true
}

func audienceMatches(message map[string]any, ctx any, audiences map[string]func(any) bool) bool {
	raw, ok := message["audience"]
	if !ok || raw == nil {
		return true
	}
	spec, ok := raw.(map[string]any)
	if !ok {
		return false
	}
	requireAll, allOK := nameList(spec, "require_all")
	requireOne, oneOK := nameList(spec, "require_one_of")
	exclude, excludeOK := nameList(spec, "exclude")
	if !allOK || !oneOK || !excludeOK {
		return false
	}
	checked := map[string]audienceResult{}
	for _, name := range append(append(append([]string{}, requireAll...), requireOne...), exclude...) {
		if _, seen := checked[name]; !seen {
			checked[name] = callAudience(audiences, name, ctx)
		}
	}
	for _, result := range checked {
		if !result.known {
			return false
		}
	}
	for _, name := range requireAll {
		if !checked[name].value {
			return false
		}
	}
	if oneRaw, has := spec["require_one_of"]; has && oneRaw != nil {
		anyTrue := false
		for _, name := range requireOne {
			if checked[name].value {
				anyTrue = true
				break
			}
		}
		if !anyTrue {
			return false
		}
	}
	for _, name := range exclude {
		if checked[name].value {
			return false
		}
	}
	return true
}

type audienceResult struct {
	known bool
	value bool
}

func nameList(spec map[string]any, key string) ([]string, bool) {
	raw, ok := spec[key]
	if !ok || raw == nil {
		return nil, true
	}
	return stringList(raw)
}

func callAudience(audiences map[string]func(any) bool, name string, ctx any) (result audienceResult) {
	fn := audiences[name]
	if fn == nil {
		return audienceResult{}
	}
	defer func() {
		if recover() != nil {
			result = audienceResult{}
		}
	}()
	return audienceResult{known: true, value: fn(ctx)}
}

func priorityOf(message map[string]any) int {
	raw, ok := message["priority"]
	if !ok || raw == nil {
		return 100
	}
	n, ok := asInt(raw)
	if !ok {
		return 100
	}
	return n
}

func limitOf(container any, fallback int) int {
	m, ok := container.(map[string]any)
	if !ok || m == nil {
		return fallback
	}
	raw, ok := m["max"]
	if !ok || raw == nil {
		return fallback
	}
	n, ok := asInt(raw)
	if !ok || n < 0 {
		return fallback
	}
	return n
}

func stringList(raw any) ([]string, bool) {
	switch names := raw.(type) {
	case []string:
		for _, name := range names {
			if name == "" {
				return nil, false
			}
		}
		return names, true
	case []any:
		out := make([]string, 0, len(names))
		for _, name := range names {
			text, ok := name.(string)
			if !ok || text == "" {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	default:
		return nil, false
	}
}

func nonEmptyString(value any) bool {
	text, ok := value.(string)
	return ok && text != ""
}

func parseTime(value any) (time.Time, bool) {
	text, ok := value.(string)
	if !ok {
		return time.Time{}, false
	}
	text = strings.TrimSpace(text)
	if t, err := time.Parse("2006-01-02", text); err == nil {
		return t.UTC(), true
	}
	normalized := text
	if strings.HasSuffix(normalized, "Z") || strings.HasSuffix(normalized, "z") {
		normalized = normalized[:len(normalized)-1] + "+00:00"
	}
	for _, layout := range []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05.999999999Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02T15:04:05.999999999",
	} {
		if t, err := time.Parse(layout, normalized); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

func resolveAssets(value any, base string) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if key == "asset" {
				if asset, ok := item.(string); ok {
					out[key] = joinAsset(asset, base)
					continue
				}
			}
			out[key] = resolveAssets(item, base)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = resolveAssets(item, base)
		}
		return out
	default:
		return value
	}
}

func joinAsset(asset, base string) string {
	if strings.HasPrefix(asset, "http://") || strings.HasPrefix(asset, "https://") || strings.HasPrefix(asset, "/") {
		return asset
	}
	if base == "" {
		return asset
	}
	if !strings.HasSuffix(base, "/") {
		base += "/"
	}
	return base + asset
}
