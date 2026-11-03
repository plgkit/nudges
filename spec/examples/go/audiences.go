// Package audiences holds example audience functions for spec/examples/messages/*.yml.
//
// In your app, this file lives at plgkit/nudges/audiences.go.
// The Audiences map keys are what a message's audience lists in YAML.
// PLGKit calls each one with the same context map you pass to decide(location, ctx),
// and sends only the true/false result to the core. Your user object
// never leaves your app.
//
// The map has a "user" map (id, species, country_code, birth_date, is_staff,
// has_active_subscription) and other facts beside it, such as organization_id.
package audiences

import "time"

func userOf(ctx map[string]any) map[string]any {
	if ctx == nil {
		return map[string]any{}
	}
	user, _ := ctx["user"].(map[string]any)
	if user == nil {
		return map[string]any{}
	}
	return user
}

func speciesOf(user map[string]any) string {
	species, _ := user["species"].(string)
	if species == "" {
		return "human"
	}
	return species
}

func ageInYears(birthDate time.Time, today time.Time) int {
	if today.IsZero() {
		today = time.Now()
	}
	birthDate = birthDate.UTC()
	today = today.UTC()
	by, bm, bd := birthDate.Date()
	ty, tm, td := today.Date()
	age := ty - by
	if tm < bm || (tm == bm && td < bd) {
		age--
	}
	return age
}

func birthDateOf(user map[string]any) (time.Time, bool) {
	switch value := user["birth_date"].(type) {
	case time.Time:
		if value.IsZero() {
			return time.Time{}, false
		}
		return value, true
	case *time.Time:
		if value == nil || value.IsZero() {
			return time.Time{}, false
		}
		return *value, true
	case string:
		parsed, err := time.Parse("2006-01-02", value)
		if err != nil {
			return time.Time{}, false
		}
		return parsed, true
	default:
		return time.Time{}, false
	}
}

// IsHuman reports whether the user's species is human.
// A missing species defaults to "human".
func IsHuman(ctx map[string]any) bool {
	return speciesOf(userOf(ctx)) == "human"
}

// IsAdult reports whether the user is at least 18.
// It returns false when no birth date is set.
func IsAdult(ctx map[string]any) bool {
	born, ok := birthDateOf(userOf(ctx))
	if !ok {
		return false
	}
	return ageInYears(born, time.Time{}) >= 18
}

// IsUSAResident reports whether the user's country code is US.
func IsUSAResident(ctx map[string]any) bool {
	code, _ := userOf(ctx)["country_code"].(string)
	return code == "US"
}

// IsUKResident reports whether the user's country code is GB.
func IsUKResident(ctx map[string]any) bool {
	code, _ := userOf(ctx)["country_code"].(string)
	return code == "GB"
}

// IsStaff reports the user's staff flag.
func IsStaff(ctx map[string]any) bool {
	staff, _ := userOf(ctx)["is_staff"].(bool)
	return staff
}

// IsDuck reports whether the user's species is duck.
// A missing species defaults to "human", so it is not a duck.
func IsDuck(ctx map[string]any) bool {
	return speciesOf(userOf(ctx)) == "duck"
}

// HasActiveSupersuitSubscription reports the user's subscription flag.
func HasActiveSupersuitSubscription(ctx map[string]any) bool {
	active, _ := userOf(ctx)["has_active_subscription"].(bool)
	return active
}

// Audiences maps the snake_case names used in message YAML to functions.
// Each function takes the same map you pass to decide.
var Audiences = map[string]func(map[string]any) bool{
	"is_human":                          IsHuman,
	"is_adult":                          IsAdult,
	"is_usa_resident":                   IsUSAResident,
	"is_uk_resident":                    IsUKResident,
	"is_staff":                          IsStaff,
	"is_duck":                           IsDuck,
	"has_active_supersuit_subscription": HasActiveSupersuitSubscription,
}
