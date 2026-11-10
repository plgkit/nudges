package plgkit

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	msgIDPattern   = regexp.MustCompile(`^\d{14}-[a-z0-9-]+$`)
	goAudienceKey  = regexp.MustCompile(`"([^"]+)":`)
	goAudiencesVar = regexp.MustCompile(`(?s)var\s+Audiences\s*=\s*map\[string\].*?\{([^}]*)\}`)
)

// Validate checks config and messages against audience map keys. It returns problem lines.
func Validate(config map[string]any, messages []map[string]any, audienceNames map[string]struct{}) []string {
	problems := checkLocations(config)
	known := audienceNames
	if known == nil {
		known = map[string]struct{}{}
	}
	for _, message := range messages {
		label := messageLabel(message)
		problems = append(problems, checkMessageAudience(label, message, known)...)
		problems = append(problems, checkMessageID(label, message)...)
	}
	return problems
}

// LoadNudgesDir reads config.yml, messages/*.yml, and audience keys from audiencesFile.
func LoadNudgesDir(root string, audiencesFile string) (map[string]any, []map[string]any, map[string]struct{}, error) {
	if audiencesFile == "" {
		audiencesFile = "audiences.go"
	}
	configPath := filepath.Join(root, "config.yml")
	raw, err := os.ReadFile(configPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("%s: config.yml not found", configPath)
	}
	var config map[string]any
	if err := yaml.Unmarshal(raw, &config); err != nil {
		return nil, nil, nil, fmt.Errorf("%s: %w", configPath, err)
	}
	if config == nil {
		config = map[string]any{}
	}

	messagesDir := filepath.Join(root, "messages")
	entries, err := os.ReadDir(messagesDir)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("%s: messages/ not found", messagesDir)
	}
	var messages []map[string]any
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yml") {
			continue
		}
		path := filepath.Join(messagesDir, entry.Name())
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, nil, nil, err
		}
		var parsed map[string]any
		if err := yaml.Unmarshal(body, &parsed); err != nil {
			return nil, nil, nil, fmt.Errorf("%s: %w", path, err)
		}
		if parsed == nil {
			return nil, nil, nil, fmt.Errorf("%s: message must be a mapping", path)
		}
		id := strings.TrimSuffix(entry.Name(), ".yml")
		parsed["id"] = id
		parsed["_path"] = "messages/" + entry.Name()
		messages = append(messages, parsed)
	}
	sort.Slice(messages, func(i, j int) bool {
		a, _ := messages[i]["_path"].(string)
		b, _ := messages[j]["_path"].(string)
		return a < b
	})

	audPath := filepath.Join(root, audiencesFile)
	audRaw, err := os.ReadFile(audPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("%s: %s not found", audPath, audiencesFile)
	}
	names, err := AudienceNamesFromGo(string(audRaw))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("%s: %w", audPath, err)
	}
	return config, messages, names, nil
}

// AudienceNamesFromGo reads keys from a var Audiences = map[string]...{...} block.
func AudienceNamesFromGo(text string) (map[string]struct{}, error) {
	match := goAudiencesVar.FindStringSubmatch(text)
	if match == nil {
		return nil, fmt.Errorf("no var Audiences map found")
	}
	return namesFromGoBody(match[1]), nil
}

func namesFromGoBody(body string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, m := range goAudienceKey.FindAllStringSubmatch(body, -1) {
		out[m[1]] = struct{}{}
	}
	return out
}

func checkLocations(config map[string]any) []string {
	locations, ok := config["locations"].(map[string]any)
	if !ok || locations == nil {
		return nil
	}
	var problems []string
	for locName, locValue := range locations {
		loc, ok := locValue.(map[string]any)
		if !ok {
			problems = append(problems, fmt.Sprintf("config.yml: locations.%s must be a mapping", locName))
			continue
		}
		locMax, ok := limitInt(loc["max"], 1)
		if !ok {
			problems = append(problems, fmt.Sprintf("config.yml: locations.%s.max must be a non-negative integer", locName))
			continue
		}
		surfaces, ok := loc["surfaces"].(map[string]any)
		if !ok || surfaces == nil {
			continue
		}
		for surfaceName, surfaceValue := range surfaces {
			surface, ok := surfaceValue.(map[string]any)
			if !ok {
				problems = append(problems, fmt.Sprintf("config.yml: locations.%s.surfaces.%s must be a mapping", locName, surfaceName))
				continue
			}
			surfaceMax, ok := limitInt(surface["max"], 1)
			if !ok {
				problems = append(problems, fmt.Sprintf("config.yml: locations.%s.surfaces.%s.max must be a non-negative integer", locName, surfaceName))
				continue
			}
			if surfaceMax > locMax {
				problems = append(problems, fmt.Sprintf(
					"config.yml: locations.%s.surfaces.%s max %d is higher than locations.%s max %d",
					locName, surfaceName, surfaceMax, locName, locMax,
				))
			}
		}
	}
	return problems
}

func checkMessageAudience(label string, message map[string]any, known map[string]struct{}) []string {
	spec, ok := message["audience"].(map[string]any)
	if !ok || spec == nil {
		return nil
	}
	var problems []string
	for _, key := range []string{"require_all", "require_one_of", "exclude"} {
		raw, exists := spec[key]
		if !exists || raw == nil {
			continue
		}
		names, ok := raw.([]any)
		if !ok {
			problems = append(problems, fmt.Sprintf("%s: audience.%s must be a list of names", label, key))
			continue
		}
		for _, item := range names {
			name, ok := item.(string)
			if !ok || name == "" {
				problems = append(problems, fmt.Sprintf("%s: audience.%s must be a list of names", label, key))
				break
			}
			if _, found := known[name]; !found {
				problems = append(problems, fmt.Sprintf(`%s: audience name "%s" is not in audiences.go`, label, name))
			}
		}
	}
	return problems
}

func checkMessageID(label string, message map[string]any) []string {
	id, _ := message["id"].(string)
	if id != "" && !msgIDPattern.MatchString(id) {
		return []string{fmt.Sprintf("%s: message id must be YYYYMMDDHHMMSS-slug", label)}
	}
	return nil
}

func messageLabel(message map[string]any) string {
	if path, ok := message["_path"].(string); ok && path != "" {
		return path
	}
	if id, ok := message["id"].(string); ok && id != "" {
		return id
	}
	return "message"
}

func limitInt(value any, defaultValue int) (int, bool) {
	if value == nil {
		return defaultValue, true
	}
	switch n := value.(type) {
	case int:
		if n >= 0 {
			return n, true
		}
	case int64:
		if n >= 0 {
			return int(n), true
		}
	case float64:
		if n >= 0 && n == float64(int(n)) {
			return int(n), true
		}
	}
	return 0, false
}
