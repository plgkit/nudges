// Package audiences holds example audience functions for spec/examples/messages/*.yml.
//
// In your app, this file lives at plgkit/nudges/audiences.go.
// The Audiences map keys are what a message's audience lists in YAML.
// PLGKit calls each one with the same context you pass to decide(location, ctx),
// and sends only the true/false result to the core. Your user object
// never leaves your app.
package audiences

import "time"

// User is an example shape. Use whatever your app already has.
type User struct {
	ID                    string
	Username              string
	CountryCode           string     // ISO 3166-1 alpha-2, e.g. "US"
	BirthDate             *time.Time // nil if unset
	Email                 *string
	Mobile                *string
	Species               string // defaults to "human"
	IsStaff               bool   // defaults to false
	HasActiveSubscription bool   // defaults to false
}

// Context is the value you pass to decide.
type Context struct {
	User           User
	Req            any     // your framework's request object, if you need it
	OrganizationID *string // flat ctx key "organization_id"; nil means missing, for example dismiss_scope
}

func speciesOf(user User) string {
	if user.Species == "" {
		return "human"
	}
	return user.Species
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

// IsHuman reports whether the user's species is human.
// An empty species defaults to "human".
func IsHuman(ctx Context) bool {
	return speciesOf(ctx.User) == "human"
}

// IsAdult reports whether the user is at least 18.
// It returns false when no birthdate is set.
func IsAdult(ctx Context) bool {
	if ctx.User.BirthDate == nil {
		return false
	}
	return ageInYears(*ctx.User.BirthDate, time.Time{}) >= 18
}

// IsUSAResident reports whether the user's country code is US.
func IsUSAResident(ctx Context) bool {
	return ctx.User.CountryCode == "US"
}

// IsUKResident reports whether the user's country code is GB.
func IsUKResident(ctx Context) bool {
	return ctx.User.CountryCode == "GB"
}

// IsStaff reports the user's staff flag.
func IsStaff(ctx Context) bool {
	return ctx.User.IsStaff
}

// IsDuck reports whether the user's species is duck.
// An empty species defaults to "human", so it is not a duck.
func IsDuck(ctx Context) bool {
	return speciesOf(ctx.User) == "duck"
}

// HasActiveSupersuitSubscription reports the user's subscription flag.
func HasActiveSupersuitSubscription(ctx Context) bool {
	return ctx.User.HasActiveSubscription
}

// Audiences maps the snake_case names used in message YAML to functions.
var Audiences = map[string]func(Context) bool{
	"is_human":                          IsHuman,
	"is_adult":                          IsAdult,
	"is_usa_resident":                   IsUSAResident,
	"is_uk_resident":                    IsUKResident,
	"is_staff":                          IsStaff,
	"is_duck":                           IsDuck,
	"has_active_supersuit_subscription": HasActiveSupersuitSubscription,
}
