package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"agent-evaluation/internal/evaluator"
	"agent-evaluation/internal/model"

	"gorm.io/gorm"
)

// TaskRunner 评测任务异步调度与执行器
type TaskRunner struct {
	db      *gorm.DB
	sandbox *SandboxManager
}

// NewTaskRunner 创建调度器
func NewTaskRunner(db *gorm.DB) *TaskRunner {
	return &TaskRunner{
		db:      db,
		sandbox: GlobalSandbox,
	}
}

// StartRun 启动一个评测运行记录
func (tr *TaskRunner) StartRun(runRecordID uint) {
	go tr.executeRun(runRecordID)
}

func (tr *TaskRunner) executeRun(runRecordID uint) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[TaskRunner] 严重异常 panic: %v", r)
			now := time.Now()
			tr.db.Model(&model.RunRecord{}).Where("id = ?", runRecordID).Updates(map[string]interface{}{
				"status":      model.RunStatusFailed,
				"finished_at": &now,
			})
		}
	}()

	var runRecord model.RunRecord
	if err := tr.db.Preload("Task").First(&runRecord, runRecordID).Error; err != nil {
		log.Printf("[TaskRunner] 加载运行记录失败 id=%d: %v", runRecordID, err)
		return
	}

	task := runRecord.Task
	if task == nil {
		log.Printf("[TaskRunner] 未找到关联的任务 id=%d", runRecord.TaskID)
		return
	}

	// 标记任务开始
	startTime := time.Now()
	tr.db.Model(&runRecord).Updates(map[string]interface{}{
		"status":     model.RunStatusRunning,
		"started_at": &startTime,
	})

	// 1. 加载 Scenario, Environment, Dataset (含用例)
	var scenario model.Scenario
	if err := tr.db.First(&scenario, task.ScenarioID).Error; err != nil {
		tr.failRun(runRecordID, fmt.Sprintf("加载场景失败: %v", err))
		return
	}

	var env model.Environment
	if err := tr.db.First(&env, task.EnvironmentID).Error; err != nil {
		tr.failRun(runRecordID, fmt.Sprintf("加载环境失败: %v", err))
		return
	}

	var cases []model.TestCase
	caseQuery := tr.db.Where("dataset_id = ?", task.DatasetID).Order("id asc")

	// 1.1 若指定了具体目标用例 ID 列表 (如仅回归上次失败用例)
	if runRecord.TargetCaseIDs != "" {
		var targetIDs []uint
		if err := json.Unmarshal([]byte(runRecord.TargetCaseIDs), &targetIDs); err == nil && len(targetIDs) > 0 {
			caseQuery = caseQuery.Where("id IN ?", targetIDs)
		}
	}

	// 1.2 用例限制数量：优先使用本次运行指定值，若未指定则沿用任务默认配置
	limit := task.CaseLimit
	if runRecord.CaseLimit > 0 {
		limit = runRecord.CaseLimit
	}
	if limit > 0 {
		caseQuery = caseQuery.Limit(limit)
	}

	if err := caseQuery.Find(&cases).Error; err != nil || len(cases) == 0 {
		tr.failRun(runRecordID, fmt.Sprintf("用例集无有效用例: %v", err))
		return
	}

	// 2. 加载系统全局配置
	var sysConfigs []model.SystemConfig
	tr.db.Find(&sysConfigs)
	globalConfigMap := make(map[string]string)
	for _, sc := range sysConfigs {
		globalConfigMap[sc.Key] = sc.Value
	}

	// 3. 加载 Evaluators
	var evalConfigs []model.TaskEvaluatorConfig
	_ = json.Unmarshal([]byte(task.EvaluatorConfigsJSON), &evalConfigs)

	var evaluatorsList []evaluator.Evaluator
	for _, cfg := range evalConfigs {
		var evalModel model.Evaluator
		if err := tr.db.First(&evalModel, cfg.EvaluatorID).Error; err == nil {
			ev, err := evaluator.NewEvaluatorFromModel(&evalModel, cfg.Weight, globalConfigMap)
			if err == nil {
				evaluatorsList = append(evaluatorsList, ev)
			}
		}
	}

	// 4. 并发 Worker Pool 控制
	concurrency := task.Concurrency
	if concurrency <= 0 {
		concurrency = 3
	}

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	var (
		totalCount       = len(cases)
		successCount     = 0
		errorCount       = 0
		machinePassCount = 0
		totalScoreSum    = 0.0
		statsMu          sync.Mutex
	)

	// 更新总用例数
	tr.db.Model(&runRecord).Update("total_count", totalCount)

	timeoutSec := 60
	if secStr, ok := globalConfigMap["default_timeout_seconds"]; ok {
		var s int
		if _, err := fmt.Sscanf(secStr, "%d", &s); err == nil && s > 0 {
			timeoutSec = s
		}
	}

	for _, testCase := range cases {
		wg.Add(1)
		sem <- struct{}{}

		go func(tc model.TestCase) {
			defer wg.Done()
			defer func() { <-sem }()

			item := tr.runSingleCase(scenario.Script, env.VariablesJSON, tc, evaluatorsList, task.MaxRetries, timeoutSec)

			statsMu.Lock()
			if item.Status == model.RunItemStatusCompleted {
				successCount++
				if item.MachinePassed {
					machinePassCount++
				}
				totalScoreSum += item.MachineScore
			} else {
				errorCount++
			}
			statsMu.Unlock()

			item.RunRecordID = runRecordID
			item.CreatedAt = time.Now()
			// 持久化单条记录
			if err := tr.db.Create(&item).Error; err != nil {
				log.Printf("[TaskRunner] 保存用例运行记录失败 case_id=%d: %v", tc.ID, err)
			}
		}(testCase)
	}

	wg.Wait()

	// 5. 汇总更新最终评测指标
	finishTime := time.Now()
	var machineAvgScore float64 = 0.0
	if successCount > 0 {
		machineAvgScore = totalScoreSum / float64(successCount)
	}

	tr.db.Model(&runRecord).Updates(map[string]interface{}{
		"status":             model.RunStatusCompleted,
		"finished_at":        &finishTime,
		"total_count":        totalCount,
		"success_count":      successCount,
		"error_count":        errorCount,
		"machine_pass_count": machinePassCount,
		"machine_avg_score":  machineAvgScore,
	})
	log.Printf("[TaskRunner] 评测任务运行完成 id=%d, 成功=%d, 错误=%d, 均分=%.2f", runRecordID, successCount, errorCount, machineAvgScore)
}

func (tr *TaskRunner) runSingleCase(
	script string,
	envJSON string,
	tc model.TestCase,
	evaluatorsList []evaluator.Evaluator,
	maxRetries int,
	timeoutSec int,
) model.RunRecordItem {
	item := model.RunRecordItem{
		TestCaseID:     tc.ID,
		InputData:      tc.InputData,
		ExpectedOutput: tc.ExpectedOutput,
	}

	if timeoutSec <= 0 {
		timeoutSec = 60
	}

	retries := 0
	var lastErr error
	var actualOutput, logs string
	var start time.Time

	for {
		start = time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
		actualOutput, logs, lastErr = tr.sandbox.ExecuteScenario(ctx, script, envJSON, tc.InputData)
		cancel()

		if lastErr == nil || retries >= maxRetries {
			break
		}
		retries++
		time.Sleep(1 * time.Second)
	}

	item.LatencyMs = time.Since(start).Milliseconds()
	item.ExecutionLog = logs

	// 判定执行异常
	if lastErr != nil {
		item.Status = model.RunItemStatusError
		item.ErrorMessage = lastErr.Error()
		item.MachineScore = 0
		item.MachinePassed = false
		item.MachineDetailsJSON = "[]"
		return item
	}

	// 正常执行完成，执行评测模块评估
	item.Status = model.RunItemStatusCompleted
	item.ActualOutput = actualOutput

	var evalResults []*evaluator.EvalResult
	evalCtx, evalCancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer evalCancel()

	for _, ev := range evaluatorsList {
		res, err := ev.Evaluate(evalCtx, tc.InputData, actualOutput, tc.ExpectedOutput)
		if err != nil {
			evalResults = append(evalResults, &evaluator.EvalResult{
				Reason: fmt.Sprintf("评测模块执行异常: %v", err),
			})
		} else {
			evalResults = append(evalResults, res)
		}
	}

	score, passed := evaluator.Aggregate(evalResults)
	item.MachineScore = score
	item.MachinePassed = passed

	detailsBytes, _ := json.Marshal(evalResults)
	item.MachineDetailsJSON = string(detailsBytes)

	return item
}

func (tr *TaskRunner) failRun(runRecordID uint, errMsg string) {
	log.Printf("[TaskRunner] 评测任务失败 id=%d: %s", runRecordID, errMsg)
	now := time.Now()
	tr.db.Model(&model.RunRecord{}).Where("id = ?", runRecordID).Updates(map[string]interface{}{
		"status":      model.RunStatusFailed,
		"finished_at": &now,
	})
}
