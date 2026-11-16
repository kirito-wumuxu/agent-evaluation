package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"agent-evaluation/internal/engine"
	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TaskHandler struct {
	db     *gorm.DB
	runner *engine.TaskRunner
}

func NewTaskHandler(db *gorm.DB, runner *engine.TaskRunner) *TaskHandler {
	return &TaskHandler{
		db:     db,
		runner: runner,
	}
}

func (h *TaskHandler) List(c *gin.Context) {
	var tasks []model.EvaluationTask
	if err := h.db.Preload("Scenario").Preload("Environment").Preload("Dataset").Order("id desc").Find(&tasks).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, tasks)
}

func (h *TaskHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var task model.EvaluationTask
	if err := h.db.Preload("Scenario").Preload("Environment").Preload("Dataset").First(&task, id).Error; err != nil {
		Error(c, http.StatusNotFound, "评测任务未找到")
		return
	}
	Success(c, task)
}

func (h *TaskHandler) Create(c *gin.Context) {
	var req struct {
		Name                 string `json:"name" binding:"required"`
		Description          string `json:"description"`
		ScenarioID           uint   `json:"scenario_id" binding:"required"`
		EnvironmentID        uint   `json:"environment_id" binding:"required"`
		DatasetID            uint   `json:"dataset_id" binding:"required"`
		EvaluatorConfigsJSON string `json:"evaluator_configs_json"`
		Concurrency          int    `json:"concurrency"`
		MaxRetries           int    `json:"max_retries"`
		CaseLimit            int    `json:"case_limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	if req.EvaluatorConfigsJSON != "" {
		var testArr []model.TaskEvaluatorConfig
		if err := json.Unmarshal([]byte(req.EvaluatorConfigsJSON), &testArr); err != nil {
			Error(c, http.StatusBadRequest, "EvaluatorConfigsJSON 格式错误，应为评测器配置数组")
			return
		}
	} else {
		req.EvaluatorConfigsJSON = "[]"
	}

	if req.Concurrency <= 0 {
		req.Concurrency = 3
	}
	if req.CaseLimit < 0 {
		req.CaseLimit = 0
	}

	if err := h.validateScenarioTagConstraints(req.ScenarioID, req.EnvironmentID, req.DatasetID, req.EvaluatorConfigsJSON); err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	task := model.EvaluationTask{
		Name:                 req.Name,
		Description:          req.Description,
		ScenarioID:           req.ScenarioID,
		EnvironmentID:        req.EnvironmentID,
		DatasetID:            req.DatasetID,
		EvaluatorConfigsJSON: req.EvaluatorConfigsJSON,
		Concurrency:          req.Concurrency,
		MaxRetries:           req.MaxRetries,
		CaseLimit:            req.CaseLimit,
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}

	if err := h.db.Create(&task).Error; err != nil {
		Error(c, http.StatusInternalServerError, "创建评测任务失败: "+err.Error())
		return
	}
	Success(c, task)
}

func (h *TaskHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var task model.EvaluationTask
	if err := h.db.First(&task, id).Error; err != nil {
		Error(c, http.StatusNotFound, "评测任务未找到")
		return
	}

	var req struct {
		Name                 string `json:"name"`
		Description          string `json:"description"`
		ScenarioID           uint   `json:"scenario_id"`
		EnvironmentID        uint   `json:"environment_id"`
		DatasetID            uint   `json:"dataset_id"`
		EvaluatorConfigsJSON string `json:"evaluator_configs_json"`
		Concurrency          int    `json:"concurrency"`
		MaxRetries           int    `json:"max_retries"`
		CaseLimit            *int   `json:"case_limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	targetScenarioID := task.ScenarioID
	if req.ScenarioID > 0 {
		targetScenarioID = req.ScenarioID
	}
	targetEnvID := task.EnvironmentID
	if req.EnvironmentID > 0 {
		targetEnvID = req.EnvironmentID
	}
	targetDatasetID := task.DatasetID
	if req.DatasetID > 0 {
		targetDatasetID = req.DatasetID
	}
	targetEvalJSON := task.EvaluatorConfigsJSON
	if req.EvaluatorConfigsJSON != "" {
		targetEvalJSON = req.EvaluatorConfigsJSON
	}

	if err := h.validateScenarioTagConstraints(targetScenarioID, targetEnvID, targetDatasetID, targetEvalJSON); err != nil {
		Error(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Name != "" {
		task.Name = req.Name
	}
	task.Description = req.Description
	task.ScenarioID = targetScenarioID
	task.EnvironmentID = targetEnvID
	task.DatasetID = targetDatasetID
	task.EvaluatorConfigsJSON = targetEvalJSON
	if req.Concurrency > 0 {
		task.Concurrency = req.Concurrency
	}
	task.MaxRetries = req.MaxRetries
	if req.CaseLimit != nil {
		if *req.CaseLimit < 0 {
			task.CaseLimit = 0
		} else {
			task.CaseLimit = *req.CaseLimit
		}
	}
	task.UpdatedAt = time.Now()

	if err := h.db.Save(&task).Error; err != nil {
		Error(c, http.StatusInternalServerError, "更新任务失败: "+err.Error())
		return
	}
	Success(c, task)
}

func (h *TaskHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.EvaluationTask{}, id).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除任务失败: "+err.Error())
		return
	}
	Success(c, gin.H{"id": id})
}

// Run 启动执行一次评测任务
func (h *TaskHandler) Run(c *gin.Context) {
	id := c.Param("id")
	var task model.EvaluationTask
	if err := h.db.First(&task, id).Error; err != nil {
		Error(c, http.StatusNotFound, "评测任务不存在")
		return
	}

	runRecord := model.RunRecord{
		TaskID:    task.ID,
		Status:    model.RunStatusPending,
		CreatedAt: time.Now(),
	}
	if err := h.db.Create(&runRecord).Error; err != nil {
		Error(c, http.StatusInternalServerError, "创建运行记录失败: "+err.Error())
		return
	}

	// 异步触发调度执行
	h.runner.StartRun(runRecord.ID)

	Success(c, gin.H{
		"run_record_id": runRecord.ID,
		"status":        runRecord.Status,
	})
}

func (h *TaskHandler) validateScenarioTagConstraints(scenarioID, environmentID, datasetID uint, evaluatorConfigsJSON string) error {
	var sc model.Scenario
	if err := h.db.First(&sc, scenarioID).Error; err != nil {
		return fmt.Errorf("指定场景不存在: %w", err)
	}

	var env model.Environment
	if err := h.db.First(&env, environmentID).Error; err != nil {
		return fmt.Errorf("指定环境配置不存在: %w", err)
	}
	if !model.MatchScenarioTags(env.ScenarioTagsJSON, sc.TagsJSON) {
		return fmt.Errorf("环境配置 [%s] 未绑定场景 [%s] 的标签约束", env.Name, sc.Name)
	}

	var ds model.Dataset
	if err := h.db.First(&ds, datasetID).Error; err != nil {
		return fmt.Errorf("指定用例集不存在: %w", err)
	}
	if !model.MatchScenarioTags(ds.ScenarioTagsJSON, sc.TagsJSON) {
		return fmt.Errorf("用例集 [%s] 未绑定场景 [%s] 的标签约束", ds.Name, sc.Name)
	}

	if evaluatorConfigsJSON != "" {
		var evalConfigs []model.TaskEvaluatorConfig
		if err := json.Unmarshal([]byte(evaluatorConfigsJSON), &evalConfigs); err == nil {
			for _, cfg := range evalConfigs {
				var ev model.Evaluator
				if err := h.db.First(&ev, cfg.EvaluatorID).Error; err == nil {
					if !model.MatchScenarioTags(ev.ScenarioTagsJSON, sc.TagsJSON) {
						return fmt.Errorf("评测模块 [%s] 未绑定场景 [%s] 的标签约束", ev.Name, sc.Name)
					}
				}
			}
		}
	}
	return nil
}
