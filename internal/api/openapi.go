package api

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"agent-evaluation/internal/engine"
	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type OpenAPIHandler struct {
	db     *gorm.DB
	runner *engine.TaskRunner
}

func NewOpenAPIHandler(db *gorm.DB, runner *engine.TaskRunner) *OpenAPIHandler {
	return &OpenAPIHandler{
		db:     db,
		runner: runner,
	}
}

// OpenAPIAuthMiddleware 开放接口鉴权中间件
// 本地 (127.0.0.1 / ::1 / localhost) 免鉴权放行；远程调用校验 X-API-Key 或 Bearer Token
func OpenAPIAuthMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		// 本地回环免鉴权直通
		if clientIP == "127.0.0.1" || clientIP == "::1" || clientIP == "localhost" {
			c.Next()
			return
		}

		// 远程调用：读取系统配置 openapi_api_key
		var sysCfg model.SystemConfig
		if err := db.Where("key = ?", "openapi_api_key").First(&sysCfg).Error; err != nil || sysCfg.Value == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "服务端未配置有效的 openapi_api_key",
			})
			return
		}

		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			authHeader := c.GetHeader("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				apiKey = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		if apiKey == "" || apiKey != sysCfg.Value {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "无效或缺失的 API Key (远程请求请携带 Header: X-API-Key 或 Authorization: Bearer <key>)",
			})
			return
		}

		c.Next()
	}
}

// ListTasks 供 Agent 发现已有评测任务及各任务最近一次运行概要
func (h *OpenAPIHandler) ListTasks(c *gin.Context) {
	var tasks []model.EvaluationTask
	if err := h.db.Preload("Scenario").Preload("Dataset").Order("id asc").Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	type TaskSummaryItem struct {
		ID           uint            `json:"id"`
		Name         string          `json:"name"`
		Description  string          `json:"description"`
		ScenarioName string          `json:"scenario_name"`
		DatasetName  string          `json:"dataset_name"`
		TotalCases   int64           `json:"total_cases"`
		CaseLimit    int             `json:"case_limit"`
		LatestRun    *gin.H          `json:"latest_run,omitempty"`
	}

	var results []TaskSummaryItem
	for _, t := range tasks {
		item := TaskSummaryItem{
			ID:          t.ID,
			Name:        t.Name,
			Description: t.Description,
			CaseLimit:   t.CaseLimit,
		}
		if t.Scenario != nil {
			item.ScenarioName = t.Scenario.Name
		}
		if t.Dataset != nil {
			item.DatasetName = t.Dataset.Name
			var count int64
			h.db.Model(&model.TestCase{}).Where("dataset_id = ?", t.DatasetID).Count(&count)
			item.TotalCases = count
		}

		// 查询该任务最近一次运行记录
		var lastRun model.RunRecord
		if err := h.db.Where("task_id = ?", t.ID).Order("id desc").First(&lastRun).Error; err == nil {
			passRate := 0.0
			if lastRun.TotalCount > 0 {
				passRate = float64(lastRun.MachinePassCount) / float64(lastRun.TotalCount) * 100
			}
			item.LatestRun = &gin.H{
				"run_id":             lastRun.ID,
				"status":             lastRun.Status,
				"total_count":        lastRun.TotalCount,
				"machine_pass_count": lastRun.MachinePassCount,
				"pass_rate":          fmt.Sprintf("%.1f%%", passRate),
				"machine_avg_score":  lastRun.MachineAvgScore,
				"has_failed_cases":   lastRun.TotalCount > lastRun.MachinePassCount,
				"created_at":         lastRun.CreatedAt.Format("2006-01-02 15:04:05"),
			}
		}

		results = append(results, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": results,
	})
}

// TriggerTask 拉起评测任务（支持 case_limit 抽样、failed_only 仅测上次失败、case_ids 指定用例）
func (h *OpenAPIHandler) TriggerTask(c *gin.Context) {
	taskID := c.Param("id")
	var task model.EvaluationTask
	if err := h.db.First(&task, taskID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "指定的评测任务不存在"})
		return
	}

	var req struct {
		CaseLimit  int    `json:"case_limit"`
		FailedOnly bool   `json:"failed_only"`
		CaseIDs    []uint `json:"case_ids"`
	}
	_ = c.ShouldBindJSON(&req)

	var targetIDs []uint

	// 1. 若指定 failed_only: 查询上次失败用例
	if req.FailedOnly {
		var lastRun model.RunRecord
		err := h.db.Where("task_id = ? AND status IN ('COMPLETED', 'FAILED')", task.ID).
			Order("id desc").First(&lastRun).Error
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "该任务暂无已完成的历史运行记录，无法提取失败用例，请先执行一次全量评测",
			})
			return
		}

		var failedItemIDs []uint
		h.db.Model(&model.RunRecordItem{}).
			Where("run_record_id = ? AND (machine_passed = false OR status = 'ERROR')", lastRun.ID).
			Pluck("test_case_id", &failedItemIDs)

		if len(failedItemIDs) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"code":    0,
				"message": "恭喜！该任务上一次运行中所有用例均已通过 (未出现失败用例)，无需复测",
				"data": gin.H{
					"run_id":      0,
					"status":      "ALL_PASSED",
					"total_cases": 0,
				},
			})
			return
		}
		targetIDs = failedItemIDs
	} else if len(req.CaseIDs) > 0 {
		targetIDs = req.CaseIDs
	}

	var targetIDsJSON string
	if len(targetIDs) > 0 {
		bytes, _ := json.Marshal(targetIDs)
		targetIDsJSON = string(bytes)
	}

	runRecord := model.RunRecord{
		TaskID:        task.ID,
		Status:        model.RunStatusPending,
		CaseLimit:     req.CaseLimit,
		TargetCaseIDs: targetIDsJSON,
		CreatedAt:     time.Now(),
	}

	if err := h.db.Create(&runRecord).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "创建运行记录失败: " + err.Error()})
		return
	}

	// 异步调起执行
	h.runner.StartRun(runRecord.ID)

	expectedCount := len(targetIDs)
	if expectedCount == 0 {
		var totalInDataset int64
		h.db.Model(&model.TestCase{}).Where("dataset_id = ?", task.DatasetID).Count(&totalInDataset)
		expectedCount = int(totalInDataset)
		if req.CaseLimit > 0 && req.CaseLimit < expectedCount {
			expectedCount = req.CaseLimit
		} else if task.CaseLimit > 0 && task.CaseLimit < expectedCount {
			expectedCount = task.CaseLimit
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"message": "评测任务已成功拉起",
		"data": gin.H{
			"run_id":         runRecord.ID,
			"task_id":        task.ID,
			"task_name":      task.Name,
			"status":         "RUNNING",
			"failed_only":    req.FailedOnly,
			"expected_cases": expectedCount,
			"target_case_ids": targetIDs,
		},
	})
}

// GetRunStatus 查询评测任务实时进度
func (h *OpenAPIHandler) GetRunStatus(c *gin.Context) {
	runID := c.Param("run_id")
	var run model.RunRecord
	if err := h.db.First(&run, runID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "指定的评测运行记录未找到"})
		return
	}

	var completedCount int64
	h.db.Model(&model.RunRecordItem{}).Where("run_record_id = ?", run.ID).Count(&completedCount)

	total := run.TotalCount
	if total == 0 {
		// 若还在统计中，估算总数
		if run.TargetCaseIDs != "" {
			var ids []uint
			_ = json.Unmarshal([]byte(run.TargetCaseIDs), &ids)
			total = len(ids)
		} else {
			var task model.EvaluationTask
			if err := h.db.First(&task, run.TaskID).Error; err == nil {
				var dsCount int64
				h.db.Model(&model.TestCase{}).Where("dataset_id = ?", task.DatasetID).Count(&dsCount)
				total = int(dsCount)
				if run.CaseLimit > 0 && run.CaseLimit < total {
					total = run.CaseLimit
				} else if task.CaseLimit > 0 && task.CaseLimit < total {
					total = task.CaseLimit
				}
			}
		}
	}

	percent := 0.0
	if total > 0 {
		percent = float64(completedCount) / float64(total) * 100
		if percent > 100 {
			percent = 100
		}
	}

	var latencyMs int64
	if run.StartedAt != nil {
		if run.FinishedAt != nil {
			latencyMs = run.FinishedAt.Sub(*run.StartedAt).Milliseconds()
		} else {
			latencyMs = time.Since(*run.StartedAt).Milliseconds()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"run_id":           run.ID,
			"task_id":          run.TaskID,
			"status":           run.Status, // PENDING, RUNNING, COMPLETED, FAILED
			"total_count":      total,
			"completed_count":  completedCount,
			"progress_percent": fmt.Sprintf("%.1f%%", percent),
			"is_finished":      run.Status == model.RunStatusCompleted || run.Status == model.RunStatusFailed,
			"latency_ms":       latencyMs,
		},
	})
}

// GetRunSummary 诊断聚焦模式结果查询（输出指标、Bad Cases 扣分理由及 Markdown 报告）
func (h *OpenAPIHandler) GetRunSummary(c *gin.Context) {
	runID := c.Param("run_id")
	var run model.RunRecord
	if err := h.db.Preload("Task").First(&run, runID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "指定的评测运行记录未找到"})
		return
	}

	var items []model.RunRecordItem
	if err := h.db.Where("run_record_id = ?", run.ID).Order("id asc").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	total := len(items)
	passedCount := 0
	failedCount := 0
	errorCount := 0
	var totalScore float64

	type BadCaseDetail struct {
		CaseID          uint              `json:"case_id"`
		ItemStatus      string            `json:"item_status"`
		InputData       string            `json:"input_data"`
		ExpectedOutput  string            `json:"expected_output"`
		ActualOutput    string            `json:"actual_output"`
		MachineScore    float64           `json:"machine_score"`
		MachinePassed   bool              `json:"machine_passed"`
		LatencyMs       int64             `json:"latency_ms"`
		ErrorMessage    string            `json:"error_message,omitempty"`
		EvaluatorJudges []gin.H           `json:"evaluator_judges,omitempty"`
	}

	var badCases []BadCaseDetail

	for _, item := range items {
		totalScore += item.MachineScore
		if item.Status == model.RunItemStatusError {
			errorCount++
		}

		if item.MachinePassed && item.Status == model.RunItemStatusCompleted {
			passedCount++
		} else {
			failedCount++

			// 解析裁判打分理由
			var judges []gin.H
			if item.MachineDetailsJSON != "" {
				var rawJudges []map[string]interface{}
				if err := json.Unmarshal([]byte(item.MachineDetailsJSON), &rawJudges); err == nil {
					for _, rj := range rawJudges {
						judges = append(judges, gin.H{
							"evaluator_name": rj["evaluator_name"],
							"score":          rj["score"],
							"passed":         rj["passed"],
							"reason":         rj["reason"],
						})
					}
				}
			}

			badCases = append(badCases, BadCaseDetail{
				CaseID:          item.TestCaseID,
				ItemStatus:      string(item.Status),
				InputData:       item.InputData,
				ExpectedOutput:  item.ExpectedOutput,
				ActualOutput:    item.ActualOutput,
				MachineScore:    item.MachineScore,
				MachinePassed:   item.MachinePassed,
				LatencyMs:       item.LatencyMs,
				ErrorMessage:    item.ErrorMessage,
				EvaluatorJudges: judges,
			})
		}
	}

	passRate := 0.0
	avgScore := 0.0
	if total > 0 {
		passRate = float64(passedCount) / float64(total) * 100
		avgScore = totalScore / float64(total)
	}

	taskName := "未知任务"
	if run.Task != nil {
		taskName = run.Task.Name
	}

	// 组装面向 Agent 的专属 Markdown 诊断报告
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("# 📊 评测诊断报告 (Run #%d)\n\n", run.ID))
	sb.WriteString(fmt.Sprintf("- **评测任务**: %s (Task #%d)\n", taskName, run.TaskID))
	sb.WriteString(fmt.Sprintf("- **执行状态**: %s\n", run.Status))
	sb.WriteString(fmt.Sprintf("- **综合得分**: **%.1f** 分 (满分 100)\n", avgScore))
	sb.WriteString(fmt.Sprintf("- **通过情况**: **%d / %d** 通过 (通过率 **%.1f%%**)\n", passedCount, total, passRate))
	if errorCount > 0 {
		sb.WriteString(fmt.Sprintf("- **异常报错**: %d 项执行抛错\n", errorCount))
	}
	sb.WriteString("\n---\n\n")

	if len(badCases) == 0 {
		sb.WriteString("### 🎉 全部用例测试通过！\n所有评测用例均达到期望标准，无未通过用例。\n")
	} else {
		sb.WriteString(fmt.Sprintf("### ❌ 失败/未通过用例归因明细 (共 %d 项)\n", len(badCases)))
		sb.WriteString("> 请参考以下失败原因与期望/实际比对，针对性自优化调整 Prompt 或逻辑：\n\n")

		for idx, bc := range badCases {
			sb.WriteString(fmt.Sprintf("#### [%d] 用例 #%d (得分: %.1f分)\n", idx+1, bc.CaseID, bc.MachineScore))
			if bc.ErrorMessage != "" {
				sb.WriteString(fmt.Sprintf("- **执行异常报错**: `%s`\n", bc.ErrorMessage))
			}
			sb.WriteString(fmt.Sprintf("- **输入数据 (Input)**: `%s`\n", truncateStr(bc.InputData, 300)))
			sb.WriteString(fmt.Sprintf("- **期望输出 (Expected)**: `%s`\n", truncateStr(bc.ExpectedOutput, 300)))
			sb.WriteString(fmt.Sprintf("- **真实输出 (Actual)**: `%s`\n", truncateStr(bc.ActualOutput, 400)))

			if len(bc.EvaluatorJudges) > 0 {
				sb.WriteString("- **评测裁判扣分理由**:\n")
				for _, j := range bc.EvaluatorJudges {
					passedText := "不通过"
					if p, ok := j["passed"].(bool); ok && p {
						passedText = "通过"
					}
					reason := j["reason"]
					if reason == nil || reason == "" {
						reason = "未提供具体说明"
					}
					sb.WriteString(fmt.Sprintf("  - **%v** (得分: %v, %s): %v\n", j["evaluator_name"], j["score"], passedText, reason))
				}
			}
			sb.WriteString("\n")
		}

		sb.WriteString("### 💡 自优化调整建议\n")
		sb.WriteString("建议分析上述 Bad Cases 的主要扣分点（格式错误、意图识别偏误、边界值缺失等），在 Prompt 的 System Prompt 或 Few-Shot 示例中强化约束规则，修改后可调用 `--failed-only` 快速复测验证。\n")
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"run_id":          run.ID,
			"task_id":         run.TaskID,
			"task_name":       taskName,
			"status":          run.Status,
			"metrics": gin.H{
				"total_count":   total,
				"passed_count":  passedCount,
				"failed_count":  failedCount,
				"error_count":   errorCount,
				"pass_rate":     fmt.Sprintf("%.1f%%", passRate),
				"avg_score":     fmt.Sprintf("%.1f", avgScore),
			},
			"bad_cases_count": len(badCases),
			"failed_cases":    badCases,
			"markdown_report": sb.String(),
		},
	})
}

func truncateStr(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// DownloadSkillTarGz 动态将 skills/agent-eval 打包为 agent-eval-skill.tar.gz 流式输出下载
func (h *OpenAPIHandler) DownloadSkillTarGz(c *gin.Context) {
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", `attachment; filename="agent-eval-skill.tar.gz"`)

	gw := gzip.NewWriter(c.Writer)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	skillDir := "skills/agent-eval"
	files := []string{"eval_client.py", "SKILL.md"}

	for _, fname := range files {
		fpath := filepath.Join(skillDir, fname)
		data, err := os.ReadFile(fpath)
		if err != nil {
			continue
		}

		mode := int64(0644)
		if strings.HasSuffix(fname, ".py") {
			mode = 0755
		}

		hdr := &tar.Header{
			Name:    filepath.Join("agent-eval", fname),
			Mode:    mode,
			Size:    int64(len(data)),
			ModTime: time.Now(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return
		}
		if _, err := tw.Write(data); err != nil {
			return
		}
	}
}

// GetOpenAPIConfig 供前端获取当前 OpenAPI 接入配置 (Base URL 和 API Key)
func (h *OpenAPIHandler) GetOpenAPIConfig(c *gin.Context) {
	var sysCfg model.SystemConfig
	_ = h.db.Where("key = ?", "openapi_api_key").First(&sysCfg).Error

	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	baseURL := fmt.Sprintf("%s://%s", scheme, c.Request.Host)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"base_url": baseURL,
			"api_key":  sysCfg.Value,
		},
	})
}
