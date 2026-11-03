package audiences

import "testing"

func TestAudienceFunctionsReadTheContextMap(t *testing.T) {
	ctx := map[string]any{
		"user": map[string]any{
			"id":                      "u_123",
			"species":                 "human",
			"country_code":            "US",
			"birth_date":              "2000-01-01",
			"is_staff":                false,
			"has_active_subscription": true,
		},
		"organization_id": "acme",
	}
	if !IsHuman(ctx) || !IsAdult(ctx) || !IsUSAResident(ctx) || !HasActiveSupersuitSubscription(ctx) {
		t.Fatal("expected the map context to match")
	}
	if IsDuck(ctx) || IsStaff(ctx) || IsUKResident(ctx) {
		t.Fatal("expected those checks to be false")
	}
	if !IsHuman(map[string]any{}) {
		t.Fatal("missing species defaults to human")
	}
	if IsAdult(map[string]any{"user": map[string]any{}}) {
		t.Fatal("missing birth date is not an adult")
	}
}
