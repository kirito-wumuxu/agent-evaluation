package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type DatasetHandler struct {
	db *gorm.DB
}

func NewDatasetHandler(db *gorm.DB) *DatasetHandler {
	return &DatasetHandler{db: db}
}

// ---------------- Dataset CRUD ----------------

func (h *DatasetHandler) ListDatasets(c *gin.Context) {
	var datasets []model.Dataset
	if err := h.db.Order("id desc").Find(&datasets).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, datasets)
}

func (h *DatasetHandler) GetDataset(c *gin.Context) {
	id := c.Param("id")
	var ds model.Dataset
	if err := h.db.First(&ds, id).Error; err != nil {
		Error(c, http.StatusNotFound, "用例集未找到")
		return
	}
	Success(c, ds)
}

func (h *DatasetHandler) CreateDataset(c *gin.Context) {
	var req struct {
		Name             string      `json:"name" binding:"required"`
		Description      string      `json:"description"`
		ColumnsJSON      string      `json:"columns_json"`
		ScenarioTagsJSON string      `json:"scenario_tags_json"`
		ScenarioTags     interface{} `json:"scenario_tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.ColumnsJSON == "" {
		req.ColumnsJSON = `[{"key":"prompt","label":"输入提示词","type":"input"},{"key":"expected","label":"期望输出","type":"expected"}]`
	}

	tagsJSON := NormalizeTagsJSON(req.ScenarioTags, req.ScenarioTagsJSON)

	ds := model.Dataset{
		Name:             req.Name,
		Description:      req.Description,
		ColumnsJSON:      req.ColumnsJSON,
		CaseCount:        0,
		ScenarioTagsJSON: tagsJSON,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
	if err := h.db.Create(&ds).Error; err != nil {
		Error(c, http.StatusInternalServerError, "创建用例集失败: "+err.Error())
		return
	}
	Success(c, ds)
}

func (h *DatasetHandler) UpdateDataset(c *gin.Context) {
	id := c.Param("id")
	var ds model.Dataset
	if err := h.db.First(&ds, id).Error; err != nil {
		Error(c, http.StatusNotFound, "用例集未找到")
		return
	}

	var req struct {
		Name             string      `json:"name"`
		Description      string      `json:"description"`
		ColumnsJSON      string      `json:"columns_json"`
		ScenarioTagsJSON string      `json:"scenario_tags_json"`
		ScenarioTags     interface{} `json:"scenario_tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.Name != "" {
		ds.Name = req.Name
	}
	if req.Description != "" {
		ds.Description = req.Description
	}
	if req.ColumnsJSON != "" {
		ds.ColumnsJSON = req.ColumnsJSON
	}
	if req.ScenarioTags != nil || req.ScenarioTagsJSON != "" {
		ds.ScenarioTagsJSON = NormalizeTagsJSON(req.ScenarioTags, req.ScenarioTagsJSON)
	}
	ds.UpdatedAt = time.Now()

	if err := h.db.Save(&ds).Error; err != nil {
		Error(c, http.StatusInternalServerError, "更新用例集失败: "+err.Error())
		return
	}
	Success(c, ds)
}

func (h *DatasetHandler) DeleteDataset(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.Dataset{}, id).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除用例集失败: "+err.Error())
		return
	}
	// 级联删除 cases
	h.db.Where("dataset_id = ?", id).Delete(&model.TestCase{})
	Success(c, gin.H{"id": id})
}

// ---------------- TestCase CRUD ----------------

func (h *DatasetHandler) ListCases(c *gin.Context) {
	datasetID := c.Param("id")
	var cases []model.TestCase
	if err := h.db.Where("dataset_id = ?", datasetID).Order("id asc").Find(&cases).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, cases)
}

// ExportCases 导出用例集内的全部用例为结构化数据
func (h *DatasetHandler) ExportCases(c *gin.Context) {
	id := c.Param("id")
	var ds model.Dataset
	if err := h.db.First(&ds, id).Error; err != nil {
		Error(c, http.StatusNotFound, "用例集未找到")
		return
	}

	var cases []model.TestCase
	if err := h.db.Where("dataset_id = ?", id).Order("id asc").Find(&cases).Error; err != nil {
		Error(c, http.StatusInternalServerError, "获取用例列表失败: "+err.Error())
		return
	}

	var columns []struct {
		Key   string `json:"key"`
		Label string `json:"label"`
		Type  string `json:"type"`
	}
	_ = json.Unmarshal([]byte(ds.ColumnsJSON), &columns)

	var exportedRows []map[string]interface{}
	for _, tc := range cases {
		row := make(map[string]interface{})

		// 先从 input_data 填充
		var inputMap map[string]interface{}
		if err := json.Unmarshal([]byte(tc.InputData), &inputMap); err == nil {
			for k, v := range inputMap {
				row[k] = v
			}
		} else {
			row["input_data"] = tc.InputData
		}

		// 从 metadata 填充
		var metaMap map[string]interface{}
		if err := json.Unmarshal([]byte(tc.MetadataJSON), &metaMap); err == nil {
			for k, v := range metaMap {
				row[k] = v
			}
		}

		// 填充 expected（支持多期望列 JSON 结构）
		var expectedMap map[string]interface{}
		if err := json.Unmarshal([]byte(tc.ExpectedOutput), &expectedMap); err == nil && expectedMap != nil {
			for k, v := range expectedMap {
				row[k] = v
			}
		} else if tc.ExpectedOutput != "" {
			row["expected"] = tc.ExpectedOutput
		}

		// 如果列配置中有指定期望列或自定义 key，对其进行规范填充
		for _, col := range columns {
			if _, exists := row[col.Key]; !exists {
				if col.Type == "expected" {
					if expectedMap != nil && expectedMap[col.Key] != nil {
						row[col.Key] = expectedMap[col.Key]
					} else {
						row[col.Key] = tc.ExpectedOutput
					}
				}
			}
		}

		exportedRows = append(exportedRows, row)
	}

	Success(c, exportedRows)
}

func (h *DatasetHandler) CreateCase(c *gin.Context) {
	datasetID := c.Param("id")
	var req struct {
		InputData      string `json:"input_data" binding:"required"`
		ExpectedOutput string `json:"expected_output"`
		MetadataJSON   string `json:"metadata_json"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.MetadataJSON == "" {
		req.MetadataJSON = "{}"
	}

	var ds model.Dataset
	if err := h.db.First(&ds, datasetID).Error; err != nil {
		Error(c, http.StatusNotFound, "用例集不存在")
		return
	}

	tc := model.TestCase{
		DatasetID:      ds.ID,
		InputData:      req.InputData,
		ExpectedOutput: req.ExpectedOutput,
		MetadataJSON:   req.MetadataJSON,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := h.db.Create(&tc).Error; err != nil {
		Error(c, http.StatusInternalServerError, "添加用例失败: "+err.Error())
		return
	}

	h.syncCaseCount(ds.ID)
	Success(c, tc)
}

func (h *DatasetHandler) UpdateCase(c *gin.Context) {
	caseID := c.Param("case_id")
	var tc model.TestCase
	if err := h.db.First(&tc, caseID).Error; err != nil {
		Error(c, http.StatusNotFound, "用例未找到")
		return
	}

	var req struct {
		InputData      string `json:"input_data"`
		ExpectedOutput string `json:"expected_output"`
		MetadataJSON   string `json:"metadata_json"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.InputData != "" {
		tc.InputData = req.InputData
	}
	tc.ExpectedOutput = req.ExpectedOutput
	if req.MetadataJSON != "" {
		tc.MetadataJSON = req.MetadataJSON
	}
	tc.UpdatedAt = time.Now()

	if err := h.db.Save(&tc).Error; err != nil {
		Error(c, http.StatusInternalServerError, "更新用例失败: "+err.Error())
		return
	}
	Success(c, tc)
}

func (h *DatasetHandler) DeleteCase(c *gin.Context) {
	caseID := c.Param("case_id")
	var tc model.TestCase
	if err := h.db.First(&tc, caseID).Error; err != nil {
		Error(c, http.StatusNotFound, "用例未找到")
		return
	}

	datasetID := tc.DatasetID
	if err := h.db.Delete(&tc).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除用例失败: "+err.Error())
		return
	}
	h.syncCaseCount(datasetID)
	Success(c, gin.H{"id": caseID})
}

// BatchImportCases 批量导入 JSON 格式用例
func (h *DatasetHandler) BatchImportCases(c *gin.Context) {
	datasetID := c.Param("id")
	var ds model.Dataset
	if err := h.db.First(&ds, datasetID).Error; err != nil {
		Error(c, http.StatusNotFound, "用例集不存在")
		return
	}

	var rawCases []struct {
		InputData      interface{} `json:"input_data"`
		ExpectedOutput string      `json:"expected_output"`
		Metadata       interface{} `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&rawCases); err != nil {
		Error(c, http.StatusBadRequest, "批量导入 JSON 结构解析失败: "+err.Error())
		return
	}

	if len(rawCases) == 0 {
		Error(c, http.StatusBadRequest, "导入用例列表为空")
		return
	}

	var newCases []model.TestCase
	now := time.Now()

	for _, item := range rawCases {
		var inputStr string
		if s, ok := item.InputData.(string); ok {
			inputStr = s
		} else {
			b, _ := json.Marshal(item.InputData)
			inputStr = string(b)
		}

		metaStr := "{}"
		if item.Metadata != nil {
			if s, ok := item.Metadata.(string); ok {
				metaStr = s
			} else {
				b, _ := json.Marshal(item.Metadata)
				metaStr = string(b)
			}
		}

		newCases = append(newCases, model.TestCase{
			DatasetID:      ds.ID,
			InputData:      inputStr,
			ExpectedOutput: item.ExpectedOutput,
			MetadataJSON:   metaStr,
			CreatedAt:      now,
			UpdatedAt:      now,
		})
	}

	if err := h.db.Create(&newCases).Error; err != nil {
		Error(c, http.StatusInternalServerError, "批量写入用例失败: "+err.Error())
		return
	}

	h.syncCaseCount(ds.ID)
	Success(c, gin.H{
		"imported_count": len(newCases),
	})
}

func (h *DatasetHandler) syncCaseCount(datasetID uint) {
	var count int64
	h.db.Model(&model.TestCase{}).Where("dataset_id = ?", datasetID).Count(&count)
	h.db.Model(&model.Dataset{}).Where("id = ?", datasetID).Update("case_count", int(count))
}

// GetCaseLatestRun 获取指定用例最近一次的实际运行结果
func (h *DatasetHandler) GetCaseLatestRun(c *gin.Context) {
	caseID := c.Param("case_id")
	var item model.RunRecordItem
	err := h.db.Where("test_case_id = ?", caseID).Order("id desc").First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		Success(c, gin.H{
			"has_run": false,
		})
		return
	} else if err != nil {
		Error(c, http.StatusInternalServerError, "查询用例运行记录失败: "+err.Error())
		return
	}

	taskName := ""
	var runRecord model.RunRecord
	if err := h.db.Preload("Task").First(&runRecord, item.RunRecordID).Error; err == nil && runRecord.Task != nil {
		taskName = runRecord.Task.Name
	}

	Success(c, gin.H{
		"has_run":              true,
		"run_record_id":        item.RunRecordID,
		"task_name":            taskName,
		"item_id":              item.ID,
		"status":               item.Status,
		"actual_output":        item.ActualOutput,
		"expected_output":      item.ExpectedOutput,
		"input_data":           item.InputData,
		"latency_ms":           item.LatencyMs,
		"machine_score":        item.MachineScore,
		"machine_passed":       item.MachinePassed,
		"machine_details_json": item.MachineDetailsJSON,
		"human_score":          item.HumanScore,
		"human_passed":         item.HumanPassed,
		"human_comment":        item.HumanComment,
		"reviewer_name":        item.ReviewerName,
		"reviewed_at":          item.ReviewedAt,
		"error_message":        item.ErrorMessage,
		"execution_log":        item.ExecutionLog,
		"created_at":           item.CreatedAt,
	})
}
