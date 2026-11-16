package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect database: %v", err)
	}

	err = db.AutoMigrate(&model.Dataset{}, &model.TestCase{})
	if err != nil {
		t.Fatalf("failed to migrate: %v", err)
	}
	return db
}

func TestExportCases_MultiExpected(t *testing.T) {
	db := setupTestDB(t)
	handler := NewDatasetHandler(db)

	colsJSON := `[
		{"key":"goal","label":"目标","type":"input"},
		{"key":"task_type","label":"任务类型","type":"expected"},
		{"key":"task_title","label":"任务标题","type":"expected"}
	]`

	ds := model.Dataset{
		Name:        "多期望测试集",
		ColumnsJSON: colsJSON,
	}
	if err := db.Create(&ds).Error; err != nil {
		t.Fatalf("failed to create dataset: %v", err)
	}

	tcMulti := model.TestCase{
		DatasetID:      ds.ID,
		InputData:      `{"goal":"每天九点发送日报"}`,
		ExpectedOutput: `{"task_type":"定时任务","task_title":"晨报提醒"}`,
		MetadataJSON:   `{}`,
	}
	tcLegacy := model.TestCase{
		DatasetID:      ds.ID,
		InputData:      `{"goal":"查询天气"}`,
		ExpectedOutput: `晴天`,
		MetadataJSON:   `{}`,
	}
	if err := db.Create(&tcMulti).Error; err != nil {
		t.Fatalf("failed to create tcMulti: %v", err)
	}
	if err := db.Create(&tcLegacy).Error; err != nil {
		t.Fatalf("failed to create tcLegacy: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	handler.ExportCases(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp struct {
		Code int                      `json:"code"`
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if len(resp.Data) != 2 {
		t.Fatalf("expected 2 exported cases, got %d", len(resp.Data))
	}

	// 验证第一个多期望列的用例：task_type 与 task_title 独立正确填充
	row1 := resp.Data[0]
	if row1["goal"] != "每天九点发送日报" {
		t.Errorf("expected goal '每天九点发送日报', got %v", row1["goal"])
	}
	if row1["task_type"] != "定时任务" {
		t.Errorf("expected task_type '定时任务', got %v", row1["task_type"])
	}
	if row1["task_title"] != "晨报提醒" {
		t.Errorf("expected task_title '晨报提醒', got %v", row1["task_title"])
	}

	// 验证第二个传统单值用例的兼容性
	row2 := resp.Data[1]
	if row2["goal"] != "查询天气" {
		t.Errorf("expected goal '查询天气', got %v", row2["goal"])
	}
	if row2["expected"] != "晴天" {
		t.Errorf("expected expected '晴天', got %v", row2["expected"])
	}
}
