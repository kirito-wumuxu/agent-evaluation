package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"agent-evaluation/internal/evaluator"
	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type EvaluatorHandler struct {
	db *gorm.DB
}

func NewEvaluatorHandler(db *gorm.DB) *EvaluatorHandler {
	return &EvaluatorHandler{db: db}
}

func (h *EvaluatorHandler) List(c *gin.Context) {
	var list []model.Evaluator
	if err := h.db.Order("id desc").Find(&list).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, list)
}

func (h *EvaluatorHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var ev model.Evaluator
	if err := h.db.First(&ev, id).Error; err != nil {
		Error(c, http.StatusNotFound, "评测模块未找到")
		return
	}
	Success(c, ev)
}

func (h *EvaluatorHandler) Create(c *gin.Context) {
	var req struct {
		Name             string              `json:"name" binding:"required"`
		Description      string              `json:"description"`
		Type             model.EvaluatorType `json:"type" binding:"required"`
		ConfigJSON       string              `json:"config_json" binding:"required"`
		ScenarioTagsJSON string              `json:"scenario_tags_json"`
		ScenarioTags     interface{}         `json:"scenario_tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.Type != "" && req.Type != model.EvaluatorTypeLLMJudge && req.Type != model.EvaluatorTypeScript {
		Error(c, http.StatusBadRequest, "评测模块类型仅支持 llm_judge (大模型裁判) 或 script (脚本裁判)")
		return
	}

	var testMap interface{}
	if err := json.Unmarshal([]byte(req.ConfigJSON), &testMap); err != nil {
		Error(c, http.StatusBadRequest, "ConfigJSON 必须是合法的 JSON 格式")
		return
	}

	tagsJSON := NormalizeTagsJSON(req.ScenarioTags, req.ScenarioTagsJSON)

	ev := model.Evaluator{
		Name:             req.Name,
		Description:      req.Description,
		Type:             req.Type,
		ConfigJSON:       req.ConfigJSON,
		ScenarioTagsJSON: tagsJSON,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
	if err := h.db.Create(&ev).Error; err != nil {
		Error(c, http.StatusInternalServerError, "创建评测模块失败: "+err.Error())
		return
	}
	Success(c, ev)
}

func (h *EvaluatorHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var ev model.Evaluator
	if err := h.db.First(&ev, id).Error; err != nil {
		Error(c, http.StatusNotFound, "评测模块未找到")
		return
	}

	var req struct {
		Name             string              `json:"name"`
		Description      string              `json:"description"`
		Type             model.EvaluatorType `json:"type"`
		ConfigJSON       string              `json:"config_json"`
		ScenarioTagsJSON string              `json:"scenario_tags_json"`
		ScenarioTags     interface{}         `json:"scenario_tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.Type != "" && req.Type != model.EvaluatorTypeLLMJudge && req.Type != model.EvaluatorTypeScript {
		Error(c, http.StatusBadRequest, "评测模块类型仅支持 llm_judge (大模型裁判) 或 script (脚本裁判)")
		return
	}

	if req.ConfigJSON != "" {
		var testMap interface{}
		if err := json.Unmarshal([]byte(req.ConfigJSON), &testMap); err != nil {
			Error(c, http.StatusBadRequest, "ConfigJSON 必须是合法的 JSON 格式")
			return
		}
		ev.ConfigJSON = req.ConfigJSON
	}

	if req.Name != "" {
		ev.Name = req.Name
	}
	ev.Description = req.Description
	if req.Type != "" {
		ev.Type = req.Type
	}
	if req.ScenarioTags != nil || req.ScenarioTagsJSON != "" {
		ev.ScenarioTagsJSON = NormalizeTagsJSON(req.ScenarioTags, req.ScenarioTagsJSON)
	}
	ev.UpdatedAt = time.Now()

	if err := h.db.Save(&ev).Error; err != nil {
		Error(c, http.StatusInternalServerError, "更新评测模块失败: "+err.Error())
		return
	}
	Success(c, ev)
}

func (h *EvaluatorHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.Evaluator{}, id).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除评测模块失败: "+err.Error())
		return
	}
	Success(c, gin.H{"id": id})
}

// TestRun 在线试跑与单步调试评测模块
func (h *EvaluatorHandler) TestRun(c *gin.Context) {
	var req struct {
		Type       model.EvaluatorType `json:"type" binding:"required"`
		ConfigJSON string              `json:"config_json" binding:"required"`
		Input      string              `json:"input"`
		Output     string              `json:"output" binding:"required"`
		Expected   string              `json:"expected"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.Type != "" && req.Type != model.EvaluatorTypeLLMJudge && req.Type != model.EvaluatorTypeScript {
		Error(c, http.StatusBadRequest, "评测模块类型仅支持 llm_judge (大模型裁判) 或 script (脚本裁判)")
		return
	}

	// 加载系统配置
	var sysConfigs []model.SystemConfig
	h.db.Find(&sysConfigs)
	globalConfigMap := make(map[string]string)
	for _, sc := range sysConfigs {
		globalConfigMap[sc.Key] = sc.Value
	}

	dummyModel := &model.Evaluator{
		ID:         0,
		Name:       "Debug Evaluator",
		Type:       req.Type,
		ConfigJSON: req.ConfigJSON,
	}

	ev, err := evaluator.NewEvaluatorFromModel(dummyModel, 1.0, globalConfigMap)
	if err != nil {
		Error(c, http.StatusBadRequest, "构建评测模块失败: "+err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := ev.Evaluate(ctx, req.Input, req.Output, req.Expected)
	if err != nil {
		Success(c, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	Success(c, gin.H{
		"success": true,
		"result":  result,
	})
}
