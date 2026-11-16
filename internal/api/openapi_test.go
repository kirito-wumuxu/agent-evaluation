package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"agent-evaluation/internal/engine"
	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupOpenAPITestEnv(t *testing.T) (*gorm.DB, *gin.Engine) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect memory db: %v", err)
	}

	_ = db.AutoMigrate(
		&model.Scenario{},
		&model.Environment{},
		&model.Dataset{},
		&model.TestCase{},
		&model.EvaluationTask{},
		&model.RunRecord{},
		&model.RunRecordItem{},
		&model.SystemConfig{},
	)

	// 初始化 API Key
	db.Create(&model.SystemConfig{
		Key:   "openapi_api_key",
		Value: "test-secret-key-123456",
	})

	runner := engine.NewTaskRunner(db)
	handler := NewOpenAPIHandler(db, runner)

	r := gin.New()
	grp := r.Group("/api/v1/openapi")
	r.GET("/api/v1/openapi/skill/download", handler.DownloadSkillTarGz)
	r.GET("/api/v1/openapi/config", handler.GetOpenAPIConfig)
	grp.Use(OpenAPIAuthMiddleware(db))
	{
		grp.GET("/tasks", handler.ListTasks)
		grp.POST("/tasks/:id/trigger", handler.TriggerTask)
		grp.GET("/runs/:run_id/status", handler.GetRunStatus)
		grp.GET("/runs/:run_id/summary", handler.GetRunSummary)
	}

	return db, r
}

func TestOpenAPI_ListTasks(t *testing.T) {
	db, r := setupOpenAPITestEnv(t)

	// 创建测试任务
	task := model.EvaluationTask{
		Name:        "测试Prompt优化任务",
		Description: "用于验证OpenAPI",
	}
	db.Create(&task)

	req := httptest.NewRequest("GET", "/api/v1/openapi/tasks", nil)
	// 本地 IP 模拟
	req.RemoteAddr = "127.0.0.1:54321"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d, body: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Code int `json:"code"`
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Code != 0 || len(resp.Data) != 1 || resp.Data[0].Name != "测试Prompt优化任务" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestOpenAPI_TriggerFailedOnly(t *testing.T) {
	db, r := setupOpenAPITestEnv(t)

	task := model.EvaluationTask{
		Name: "SQL优化任务",
	}
	db.Create(&task)

	// 模拟上一次已完成的运行记录，包含 1 个成功 Case(101) 和 1 个失败 Case(102)
	lastRun := model.RunRecord{
		TaskID:           task.ID,
		Status:           model.RunStatusCompleted,
		TotalCount:       2,
		SuccessCount:     2,
		MachinePassCount: 1,
		CreatedAt:        time.Now().Add(-10 * time.Minute),
	}
	db.Create(&lastRun)

	db.Create(&model.RunRecordItem{
		RunRecordID:    lastRun.ID,
		TestCaseID:     101,
		Status:         model.RunItemStatusCompleted,
		MachinePassed:  true,
		MachineScore:   100,
	})
	db.Create(&model.RunRecordItem{
		RunRecordID:    lastRun.ID,
		TestCaseID:     102,
		Status:         model.RunItemStatusCompleted,
		MachinePassed:  false,
		MachineScore:   30,
	})

	// 请求仅重跑失败用例
	payload := `{"failed_only": true}`
	req := httptest.NewRequest("POST", "/api/v1/openapi/tasks/1/trigger", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "127.0.0.1:54321"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("trigger failed-only returned %d, body: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Code int `json:"code"`
		Data struct {
			RunID          uint   `json:"run_id"`
			Status         string `json:"status"`
			TargetCaseIDs  []uint `json:"target_case_ids"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Data.RunID == 0 || resp.Data.Status != "RUNNING" {
		t.Fatalf("invalid run data: %+v", resp)
	}
	if len(resp.Data.TargetCaseIDs) != 1 || resp.Data.TargetCaseIDs[0] != 102 {
		t.Fatalf("expected target case 102, got: %+v", resp.Data.TargetCaseIDs)
	}
}

func TestOpenAPI_GetRunSummary_BadCaseFocused(t *testing.T) {
	db, r := setupOpenAPITestEnv(t)

	task := model.EvaluationTask{
		Name: "助手准确度测试",
	}
	db.Create(&task)

	run := model.RunRecord{
		TaskID:           task.ID,
		Status:           model.RunStatusCompleted,
		TotalCount:       2,
		MachinePassCount: 1,
		MachineAvgScore:  50.0,
	}
	db.Create(&run)

	// 1 个通过
	db.Create(&model.RunRecordItem{
		RunRecordID:   run.ID,
		TestCaseID:    1,
		InputData:     `{"q":"hello"}`,
		ActualOutput:  "hello world",
		Status:        model.RunItemStatusCompleted,
		MachinePassed: true,
		MachineScore:  100,
	})

	// 1 个未通过，附带裁判打分理由
	details := `[{"evaluator_name":"LLM裁判","score":0,"passed":false,"reason":"未按要求输出JSON格式"}]`
	db.Create(&model.RunRecordItem{
		RunRecordID:        run.ID,
		TestCaseID:         2,
		InputData:          `{"q":"parse json"}`,
		ExpectedOutput:     `{"status":"ok"}`,
		ActualOutput:       `invalid text`,
		Status:             model.RunItemStatusCompleted,
		MachinePassed:      false,
		MachineScore:       0,
		MachineDetailsJSON: details,
	})

	req := httptest.NewRequest("GET", "/api/v1/openapi/runs/1/summary", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("summary returned %d, body: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Code int `json:"code"`
		Data struct {
			BadCasesCount int `json:"bad_cases_count"`
			FailedCases   []struct {
				CaseID          uint `json:"case_id"`
				EvaluatorJudges []struct {
					EvaluatorName string `json:"evaluator_name"`
					Reason        string `json:"reason"`
				} `json:"evaluator_judges"`
			} `json:"failed_cases"`
			MarkdownReport string `json:"markdown_report"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Data.BadCasesCount != 1 {
		t.Fatalf("expected 1 bad case, got %d", resp.Data.BadCasesCount)
	}
	if len(resp.Data.FailedCases) != 1 || resp.Data.FailedCases[0].CaseID != 2 {
		t.Fatalf("bad case ID mismatch: %+v", resp.Data.FailedCases)
	}
	if len(resp.Data.FailedCases[0].EvaluatorJudges) == 0 || resp.Data.FailedCases[0].EvaluatorJudges[0].Reason != "未按要求输出JSON格式" {
		t.Fatalf("judge reason mismatch: %+v", resp.Data.FailedCases[0].EvaluatorJudges)
	}
	if resp.Data.MarkdownReport == "" {
		t.Fatalf("expected markdown report")
	}
}

func TestOpenAPI_DownloadAndConfig(t *testing.T) {
	_, r := setupOpenAPITestEnv(t)

	// 1. 测试下载 tar.gz
	reqDl := httptest.NewRequest("GET", "/api/v1/openapi/skill/download", nil)
	wDl := httptest.NewRecorder()
	r.ServeHTTP(wDl, reqDl)

	if wDl.Code != http.StatusOK {
		t.Fatalf("download returned %d", wDl.Code)
	}
	if ct := wDl.Header().Get("Content-Type"); ct != "application/gzip" {
		t.Fatalf("expected application/gzip, got %s", ct)
	}

	// 2. 测试获取配置
	reqCfg := httptest.NewRequest("GET", "/api/v1/openapi/config", nil)
	wCfg := httptest.NewRecorder()
	r.ServeHTTP(wCfg, reqCfg)

	if wCfg.Code != http.StatusOK {
		t.Fatalf("config returned %d", wCfg.Code)
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			BaseURL string `json:"base_url"`
			APIKey  string `json:"api_key"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wCfg.Body.Bytes(), &resp)
	if resp.Data.APIKey != "test-secret-key-123456" {
		t.Fatalf("expected api key test-secret-key-123456, got %s", resp.Data.APIKey)
	}
}
