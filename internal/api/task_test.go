package api

import (
	"agent-evaluation/internal/model"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestTaskScenarioTagConstraints(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Scenario{},
		&model.Environment{},
		&model.Dataset{},
		&model.Evaluator{},
		&model.EvaluationTask{},
	); err != nil {
		t.Fatalf("auto migrate failed: %v", err)
	}

	handler := NewTaskHandler(db, nil)

	// Create Scenario with tag "cron"
	scCron := model.Scenario{
		Name:     "Cron Scenario",
		TagsJSON: `["cron"]`,
	}
	db.Create(&scCron)

	// Create Scenario with tag "finance"
	scFin := model.Scenario{
		Name:     "Finance Scenario",
		TagsJSON: `["finance"]`,
	}
	db.Create(&scFin)

	// Create Universal Env ("*") and Cron Env ("cron")
	envUniversal := model.Environment{
		Name:             "Universal Env",
		ScenarioTagsJSON: `["*"]`,
	}
	db.Create(&envUniversal)

	envCron := model.Environment{
		Name:             "Cron Only Env",
		ScenarioTagsJSON: `["cron"]`,
	}
	db.Create(&envCron)

	// Create Datasets
	dsCron := model.Dataset{
		Name:             "Cron Dataset",
		ScenarioTagsJSON: `["cron"]`,
	}
	db.Create(&dsCron)

	dsFin := model.Dataset{
		Name:             "Finance Dataset",
		ScenarioTagsJSON: `["finance"]`,
	}
	db.Create(&dsFin)

	// Create Evaluators
	evUniversal := model.Evaluator{
		Name:             "Universal Evaluator",
		ScenarioTagsJSON: `["*"]`,
	}
	db.Create(&evUniversal)

	evFin := model.Evaluator{
		Name:             "Finance Evaluator",
		ScenarioTagsJSON: `["finance"]`,
	}
	db.Create(&evFin)

	// 1. Cron Scenario + Universal Env + Cron Dataset + Universal Evaluator -> Should Pass
	err = handler.validateScenarioTagConstraints(scCron.ID, envUniversal.ID, dsCron.ID, `[{"evaluator_id":`+intToStr(int(evUniversal.ID))+`,"weight":1}]`)
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}

	// 2. Cron Scenario + Cron Env + Cron Dataset -> Should Pass
	err = handler.validateScenarioTagConstraints(scCron.ID, envCron.ID, dsCron.ID, "")
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}

	// 3. Finance Scenario + Cron Env -> Should Fail (Env not compatible)
	err = handler.validateScenarioTagConstraints(scFin.ID, envCron.ID, dsFin.ID, "")
	if err == nil {
		t.Fatalf("expected error due to env tag mismatch, got nil")
	}

	// 4. Finance Scenario + Universal Env + Cron Dataset -> Should Fail (Dataset not compatible)
	err = handler.validateScenarioTagConstraints(scFin.ID, envUniversal.ID, dsCron.ID, "")
	if err == nil {
		t.Fatalf("expected error due to dataset tag mismatch, got nil")
	}

	// 5. Cron Scenario + Universal Env + Cron Dataset + Finance Evaluator -> Should Fail (Evaluator not compatible)
	err = handler.validateScenarioTagConstraints(scCron.ID, envUniversal.ID, dsCron.ID, `[{"evaluator_id":`+intToStr(int(evFin.ID))+`,"weight":1}]`)
	if err == nil {
		t.Fatalf("expected error due to evaluator tag mismatch, got nil")
	}
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
