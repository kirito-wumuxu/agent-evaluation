package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupRunTestEnv(t *testing.T) (*gorm.DB, *gin.Engine, *RunHandler) {
	gin.SetMode(gin.TestMode)
	dsn := "file:" + t.Name() + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect memory db: %v", err)
	}

	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(1)
	}

	_ = db.AutoMigrate(
		&model.Scenario{},
		&model.Environment{},
		&model.Dataset{},
		&model.TestCase{},
		&model.Evaluator{},
		&model.EvaluationTask{},
		&model.RunRecord{},
		&model.RunRecordItem{},
		&model.SystemConfig{},
	)

	handler := NewRunHandler(db)

	r := gin.New()
	v1 := r.Group("/api/v1")
	{
		v1.GET("/runs", handler.List)
		v1.GET("/runs/:id", handler.Get)
		v1.DELETE("/runs/:id", handler.Delete)
		v1.GET("/runs/:id/items", handler.ListItems)
		v1.POST("/runs/:id/items/:item_id/review", handler.ReviewItem)
		v1.POST("/runs/:id/reevaluate", handler.Reevaluate)
		v1.POST("/runs/:id/items/:item_id/reevaluate", handler.ReevaluateItem)
	}

	return db, r, handler
}

func TestReevaluateSingleItem(t *testing.T) {
	db, r, _ := setupRunTestEnv(t)

	// 1. 创建评测器 (Script 评测器：若 actual === expected 则得 100 分通过，否则 0 分)
	scriptEv := model.Evaluator{
		Name:             "Exact Match Evaluator",
		Type:             model.EvaluatorTypeScript,
		ConfigJSON:       `{"script":"function evaluate(input, actual, expected) { return { score: actual === expected ? 100 : 0, passed: actual === expected, reason: actual === expected ? 'OK' : 'Mismatch' }; }"}`,
		ScenarioTagsJSON: `["*"]`,
	}
	db.Create(&scriptEv)

	// 2. 创建评测任务关联该 Evaluator
	evalConfigs := []model.TaskEvaluatorConfig{
		{EvaluatorID: scriptEv.ID, Weight: 1.0},
	}
	evalConfigsJSON, _ := json.Marshal(evalConfigs)

	task := model.EvaluationTask{
		Name:                 "测试任务",
		EvaluatorConfigsJSON: string(evalConfigsJSON),
	}
	db.Create(&task)

	// 3. 创建测试用例
	testCase := model.TestCase{
		InputData:      `{"prompt":"hello"}`,
		ExpectedOutput: `original_expected`,
	}
	db.Create(&testCase)

	// 4. 创建运行记录与明细 (初始期望是 original_expected，实际输出是 updated_expected，得分为 0)
	runRecord := model.RunRecord{
		TaskID:           task.ID,
		Status:           model.RunStatusCompleted,
		TotalCount:       1,
		SuccessCount:     1,
		ErrorCount:       0,
		MachinePassCount: 0,
		MachineAvgScore:  0.0,
	}
	db.Create(&runRecord)

	now := time.Now()
	runItem := model.RunRecordItem{
		RunRecordID:    runRecord.ID,
		TestCaseID:     testCase.ID,
		InputData:      testCase.InputData,
		ExpectedOutput: testCase.ExpectedOutput,
		ActualOutput:   `updated_expected`,
		Status:         model.RunItemStatusCompleted,
		MachineScore:   0,
		MachinePassed:  false,
		CreatedAt:      now,
	}
	db.Create(&runItem)

	// 5. 模拟在用例集修改了该用例的期望输出，改为 updated_expected
	testCase.ExpectedOutput = `updated_expected`
	db.Save(&testCase)

	// 6. 调用单个用例重新评测接口
	url := fmt.Sprintf("/api/v1/runs/%d/items/%d/reevaluate", runRecord.ID, runItem.ID)
	req := httptest.NewRequest("POST", url, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d, body: %s", w.Code, w.Body.String())
	}

	// 7. 检验用例明细已更新
	var updatedItem model.RunRecordItem
	db.First(&updatedItem, runItem.ID)
	if updatedItem.ExpectedOutput != `updated_expected` {
		t.Errorf("expected updated ExpectedOutput, got %s", updatedItem.ExpectedOutput)
	}
	if updatedItem.MachineScore != 100 {
		t.Errorf("expected MachineScore=100, got %f", updatedItem.MachineScore)
	}
	if !updatedItem.MachinePassed {
		t.Errorf("expected MachinePassed=true, got false")
	}

	// 8. 检验批次指标已重新聚合
	var updatedRun model.RunRecord
	db.First(&updatedRun, runRecord.ID)
	if updatedRun.MachinePassCount != 1 {
		t.Errorf("expected MachinePassCount=1, got %d", updatedRun.MachinePassCount)
	}
	if updatedRun.MachineAvgScore != 100.0 {
		t.Errorf("expected MachineAvgScore=100.0, got %f", updatedRun.MachineAvgScore)
	}
}

func TestReevaluateRun_All(t *testing.T) {
	db, r, _ := setupRunTestEnv(t)

	// 创建 Script 评测器
	scriptEv := model.Evaluator{
		Name:             "Length Match Evaluator",
		Type:             model.EvaluatorTypeScript,
		ConfigJSON:       `{"script":"function evaluate(input, actual, expected) { return { score: actual === expected ? 100 : 0, passed: actual === expected, reason: '' }; }"}`,
		ScenarioTagsJSON: `["*"]`,
	}
	db.Create(&scriptEv)

	evalConfigs, _ := json.Marshal([]model.TaskEvaluatorConfig{
		{EvaluatorID: scriptEv.ID, Weight: 1.0},
	})

	task := model.EvaluationTask{
		Name:                 "批量测试任务",
		EvaluatorConfigsJSON: string(evalConfigs),
		Concurrency:          2,
	}
	db.Create(&task)

	// 创建 2 条用例
	tc1 := model.TestCase{InputData: "input1", ExpectedOutput: "old1"}
	tc2 := model.TestCase{InputData: "input2", ExpectedOutput: "old2"}
	db.Create(&tc1)
	db.Create(&tc2)

	runRecord := model.RunRecord{
		TaskID:           task.ID,
		Status:           model.RunStatusCompleted,
		TotalCount:       2,
		SuccessCount:     2,
		ErrorCount:       0,
		MachinePassCount: 0,
		MachineAvgScore:  0,
	}
	db.Create(&runRecord)

	item1 := model.RunRecordItem{
		RunRecordID:    runRecord.ID,
		TestCaseID:     tc1.ID,
		InputData:      tc1.InputData,
		ExpectedOutput: tc1.ExpectedOutput,
		ActualOutput:   "new1",
		Status:         model.RunItemStatusCompleted,
	}
	item2 := model.RunRecordItem{
		RunRecordID:    runRecord.ID,
		TestCaseID:     tc2.ID,
		InputData:      tc2.InputData,
		ExpectedOutput: tc2.ExpectedOutput,
		ActualOutput:   "new2",
		Status:         model.RunItemStatusCompleted,
	}
	db.Create(&item1)
	db.Create(&item2)

	// 更新用例集期望输出
	tc1.ExpectedOutput = "new1"
	tc2.ExpectedOutput = "new2"
	db.Save(&tc1)
	db.Save(&tc2)

	// 调用全量重新评测接口
	url := fmt.Sprintf("/api/v1/runs/%d/reevaluate", runRecord.ID)
	req := httptest.NewRequest("POST", url, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d, body: %s", w.Code, w.Body.String())
	}

	var updatedRun model.RunRecord
	db.First(&updatedRun, runRecord.ID)
	if updatedRun.MachinePassCount != 2 {
		t.Errorf("expected MachinePassCount=2, got %d", updatedRun.MachinePassCount)
	}
	if updatedRun.MachineAvgScore != 100.0 {
		t.Errorf("expected MachineAvgScore=100.0, got %f", updatedRun.MachineAvgScore)
	}
}
