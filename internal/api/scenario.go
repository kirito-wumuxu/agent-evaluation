package api

import (
	"context"
	"net/http"
	"time"

	"agent-evaluation/internal/engine"
	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ScenarioHandler struct {
	db      *gorm.DB
	sandbox *engine.SandboxManager
}

func NewScenarioHandler(db *gorm.DB) *ScenarioHandler {
	return &ScenarioHandler{
		db:      db,
		sandbox: engine.GlobalSandbox,
	}
}

func (h *ScenarioHandler) List(c *gin.Context) {
	var scenarios []model.Scenario
	if err := h.db.Order("id desc").Find(&scenarios).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, scenarios)
}

func (h *ScenarioHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var sc model.Scenario
	if err := h.db.First(&sc, id).Error; err != nil {
		Error(c, http.StatusNotFound, "场景配置未找到")
		return
	}
	Success(c, sc)
}

func (h *ScenarioHandler) Create(c *gin.Context) {
	var req struct {
		Name        string      `json:"name" binding:"required"`
		Description string      `json:"description"`
		Script      string      `json:"script" binding:"required"`
		TagsJSON    string      `json:"tags_json"`
		Tags        interface{} `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请求参数校验失败: "+err.Error())
		return
	}

	tagsJSON := NormalizeTagsJSON(req.Tags, req.TagsJSON)

	sc := model.Scenario{
		Name:        req.Name,
		Description: req.Description,
		Script:      req.Script,
		TagsJSON:    tagsJSON,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if err := h.db.Create(&sc).Error; err != nil {
		Error(c, http.StatusInternalServerError, "创建场景失败: "+err.Error())
		return
	}
	Success(c, sc)
}

func (h *ScenarioHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var sc model.Scenario
	if err := h.db.First(&sc, id).Error; err != nil {
		Error(c, http.StatusNotFound, "场景配置未找到")
		return
	}

	var req struct {
		Name        string      `json:"name"`
		Description string      `json:"description"`
		Script      string      `json:"script"`
		TagsJSON    string      `json:"tags_json"`
		Tags        interface{} `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请求参数校验失败: "+err.Error())
		return
	}

	if req.Name != "" {
		sc.Name = req.Name
	}
	sc.Description = req.Description
	if req.Script != "" {
		sc.Script = req.Script
	}
	if req.Tags != nil || req.TagsJSON != "" {
		sc.TagsJSON = NormalizeTagsJSON(req.Tags, req.TagsJSON)
	}
	sc.UpdatedAt = time.Now()

	if err := h.db.Save(&sc).Error; err != nil {
		Error(c, http.StatusInternalServerError, "更新场景失败: "+err.Error())
		return
	}
	Success(c, sc)
}

func (h *ScenarioHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.Scenario{}, id).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除场景失败: "+err.Error())
		return
	}
	Success(c, gin.H{"id": id})
}

// TestRun 在线试跑与单步调试场景脚本
func (h *ScenarioHandler) TestRun(c *gin.Context) {
	var req struct {
		Script        string `json:"script" binding:"required"`
		EnvironmentID uint   `json:"environment_id"`
		VariablesJSON string `json:"variables_json"`
		InputData     string `json:"input_data" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	envJSON := req.VariablesJSON
	if envJSON == "" && req.EnvironmentID > 0 {
		var env model.Environment
		if err := h.db.First(&env, req.EnvironmentID).Error; err == nil {
			envJSON = env.VariablesJSON
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	start := time.Now()
	output, logs, err := h.sandbox.ExecuteScenario(ctx, req.Script, envJSON, req.InputData)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		Success(c, gin.H{
			"success":    false,
			"error":      err.Error(),
			"logs":       logs,
			"latency_ms": latency,
		})
		return
	}

	Success(c, gin.H{
		"success":    true,
		"output":     output,
		"logs":       logs,
		"latency_ms": latency,
	})
}
