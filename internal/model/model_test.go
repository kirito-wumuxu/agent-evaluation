package model

import (
	"testing"
)

func TestMatchScenarioTags(t *testing.T) {
	tests := []struct {
		name         string
		resourceTags string
		scenarioTags string
		expected     bool
	}{
		{
			name:         "Global resource matches anything",
			resourceTags: `["*"]`,
			scenarioTags: `["cron"]`,
			expected:     true,
		},
		{
			name:         "Global resource with keyword global",
			resourceTags: `["global"]`,
			scenarioTags: `["customer_service"]`,
			expected:     true,
		},
		{
			name:         "Exact tag match",
			resourceTags: `["cron"]`,
			scenarioTags: `["cron"]`,
			expected:     true,
		},
		{
			name:         "Tag intersection match with multiple tags",
			resourceTags: `["finance", "cron", "report"]`,
			scenarioTags: `["weather", "cron"]`,
			expected:     true,
		},
		{
			name:         "Tag mismatch",
			resourceTags: `["finance"]`,
			scenarioTags: `["cron"]`,
			expected:     false,
		},
		{
			name:         "Empty resource tags defaults to true",
			resourceTags: `[]`,
			scenarioTags: `["cron"]`,
			expected:     true,
		},
		{
			name:         "Empty scenario tags defaults to true",
			resourceTags: `["finance"]`,
			scenarioTags: `[]`,
			expected:     true,
		},
		{
			name:         "Scenario has wildcard",
			resourceTags: `["finance"]`,
			scenarioTags: `["*"]`,
			expected:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MatchScenarioTags(tt.resourceTags, tt.scenarioTags)
			if got != tt.expected {
				t.Errorf("MatchScenarioTags(%s, %s) = %v; want %v", tt.resourceTags, tt.scenarioTags, got, tt.expected)
			}
		})
	}
}
