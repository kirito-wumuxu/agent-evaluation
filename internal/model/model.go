package model

import (
	"encoding/json"
	"strings"
	"time"
)

// Environment 目标运行环境配置
type Environment struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	Name             string    `gorm:"size:128;not null;uniqueIndex" json:"name"`
	Description      string    `gorm:"type:text" json:"description"`
	VariablesJSON    string    `gorm:"type:text;not null;default:'{}'" json:"variables_json"`
	ScenarioTagsJSON string    `gorm:"type:text;not null;default:'[\"*\"]'" json:"scenario_tags_json"` // 适用场景标签，如 ["*"] 或 ["cron"]
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// Scenario 场景配置与 Goja 脚本
type Scenario struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:128;not null;uniqueIndex" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	Script      string    `gorm:"type:text;not null" json:"script"` // Goja JS: execute(env, input)
	TagsJSON    string    `gorm:"type:text;not null;default:'[\"*\"]'" json:"tags_json"` // 场景业务标签，如 ["cron", "finance"]
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Dataset 评测用例集
type Dataset struct {
	ID               uint        `gorm:"primaryKey" json:"id"`
	Name             string      `gorm:"size:128;not null;uniqueIndex" json:"name"`
	Description      string      `gorm:"type:text" json:"description"`
	ColumnsJSON      string      `gorm:"type:text;not null;default:'[]'" json:"columns_json"` // 动态列定义: [{"key":"prompt","label":"输入提示词","type":"input"}]
	CaseCount        int         `gorm:"not null;default:0" json:"case_count"`
	ScenarioTagsJSON string      `gorm:"type:text;not null;default:'[\"*\"]'" json:"scenario_tags_json"` // 适用场景标签
	Cases            []TestCase  `gorm:"foreignKey:DatasetID;constraint:OnDelete:CASCADE" json:"cases,omitempty"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
}

// TestCase 单条评测用例
type TestCase struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	DatasetID      uint      `gorm:"not null;index" json:"dataset_id"`
	InputData      string    `gorm:"type:text;not null" json:"input_data"`
	ExpectedOutput string    `gorm:"type:text" json:"expected_output"`
	MetadataJSON   string    `gorm:"type:text;default:'{}'" json:"metadata_json"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// EvaluatorType 评测模块类型
type EvaluatorType string

const (
	EvaluatorTypeLLMJudge EvaluatorType = "llm_judge"
	EvaluatorTypeScript   EvaluatorType = "script"
)

// Evaluator 评测模块定义
type Evaluator struct {
	ID               uint          `gorm:"primaryKey" json:"id"`
	Name             string        `gorm:"size:128;not null;uniqueIndex" json:"name"`
	Description      string        `gorm:"type:text" json:"description"`
	Type             EvaluatorType `gorm:"size:32;not null" json:"type"`
	ConfigJSON       string        `gorm:"type:text;not null;default:'{}'" json:"config_json"`
	ScenarioTagsJSON string        `gorm:"type:text;not null;default:'[\"*\"]'" json:"scenario_tags_json"` // 适用场景标签
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

// TaskEvaluatorConfig 任务关联的评测器配置项
type TaskEvaluatorConfig struct {
	EvaluatorID uint    `json:"evaluator_id"`
	Weight      float64 `json:"weight"`
}

// EvaluationTask 评测任务定义
type EvaluationTask struct {
	ID                   uint         `gorm:"primaryKey" json:"id"`
	Name                 string       `gorm:"size:128;not null" json:"name"`
	Description          string       `gorm:"type:text" json:"description"`
	ScenarioID           uint         `gorm:"not null" json:"scenario_id"`
	EnvironmentID        uint         `gorm:"not null" json:"environment_id"`
	DatasetID            uint         `gorm:"not null" json:"dataset_id"`
	EvaluatorConfigsJSON string       `gorm:"type:text;not null;default:'[]'" json:"evaluator_configs_json"`
	Concurrency          int          `gorm:"not null;default:3" json:"concurrency"`
	MaxRetries           int          `gorm:"not null;default:0" json:"max_retries"`
	CaseLimit            int          `gorm:"not null;default:0" json:"case_limit"` // 执行用例数量，0表示执行全部
	Scenario             *Scenario    `gorm:"foreignKey:ScenarioID" json:"scenario,omitempty"`
	Environment          *Environment `gorm:"foreignKey:EnvironmentID" json:"environment,omitempty"`
	Dataset              *Dataset     `gorm:"foreignKey:DatasetID" json:"dataset,omitempty"`
	CreatedAt            time.Time    `json:"created_at"`
	UpdatedAt            time.Time    `json:"updated_at"`
}

// RunStatus 任务执行状态
type RunStatus string

const (
	RunStatusPending   RunStatus = "PENDING"
	RunStatusRunning   RunStatus = "RUNNING"
	RunStatusCompleted RunStatus = "COMPLETED"
	RunStatusFailed    RunStatus = "FAILED"
	RunStatusCanceled  RunStatus = "CANCELED"
)

// RunRecord 评测任务的单次运行记录
type RunRecord struct {
	ID               uint            `gorm:"primaryKey" json:"id"`
	TaskID           uint            `gorm:"not null;index" json:"task_id"`
	Task             *EvaluationTask `gorm:"foreignKey:TaskID" json:"task,omitempty"`
	Status           RunStatus       `gorm:"size:32;not null;default:'PENDING'" json:"status"`
	TotalCount       int             `gorm:"not null;default:0" json:"total_count"`
	SuccessCount     int             `gorm:"not null;default:0" json:"success_count"`
	ErrorCount       int             `gorm:"not null;default:0" json:"error_count"`
	
	// 机器自动化评测聚合
	MachinePassCount int             `gorm:"not null;default:0" json:"machine_pass_count"`
	MachineAvgScore  float64         `gorm:"not null;default:0.0" json:"machine_avg_score"`
	
	// 人工复核聚合
	HumanPassCount   int             `gorm:"not null;default:0" json:"human_pass_count"`
	HumanAvgScore    float64         `gorm:"not null;default:0.0" json:"human_avg_score"`
	ReviewedCount    int             `gorm:"not null;default:0" json:"reviewed_count"`
	
	Items            []RunRecordItem `gorm:"foreignKey:RunRecordID;constraint:OnDelete:CASCADE" json:"items,omitempty"`
	CaseLimit        int             `gorm:"not null;default:0" json:"case_limit"`         // 本次运行限定用例数 (0为使用任务默认)
	TargetCaseIDs    string          `gorm:"type:text" json:"target_case_ids"`            // 本次运行指定用例 ID 列表 (JSON 数组，如 [1, 2])
	StartedAt        *time.Time      `json:"started_at"`
	FinishedAt       *time.Time      `json:"finished_at"`
	CreatedAt        time.Time       `json:"created_at"`
}

// RunItemStatus 单用例执行状态
type RunItemStatus string

const (
	RunItemStatusCompleted RunItemStatus = "COMPLETED"
	RunItemStatusError     RunItemStatus = "ERROR"
)

// RunRecordItem 单条用例运行结果与复核双轨记录
type RunRecordItem struct {
	ID                  uint          `gorm:"primaryKey" json:"id"`
	RunRecordID         uint          `gorm:"not null;index" json:"run_record_id"`
	TestCaseID          uint          `gorm:"not null" json:"test_case_id"`
	TestCase            *TestCase     `gorm:"foreignKey:TestCaseID" json:"test_case,omitempty"`
	InputData           string        `gorm:"type:text;not null" json:"input_data"`
	ExpectedOutput      string        `gorm:"type:text" json:"expected_output"`
	ActualOutput        string        `gorm:"type:text" json:"actual_output"`
	Status              RunItemStatus `gorm:"size:32;not null" json:"status"` // COMPLETED or ERROR
	ErrorMessage        string        `gorm:"type:text" json:"error_message"`
	LatencyMs           int64         `gorm:"not null;default:0" json:"latency_ms"`
	ExecutionLog        string        `gorm:"type:text" json:"execution_log"`
	
	// 机器评估
	MachineScore        float64       `gorm:"not null;default:0.0" json:"machine_score"`
	MachinePassed       bool          `gorm:"not null;default:false" json:"machine_passed"`
	MachineDetailsJSON  string        `gorm:"type:text;default:'[]'" json:"machine_details_json"`
	
	// 人工复核双轨
	HumanScore          *float64      `json:"human_score"`
	HumanPassed         *bool         `json:"human_passed"`
	HumanComment        string        `gorm:"type:text" json:"human_comment"`
	ReviewerName        string        `gorm:"size:64" json:"reviewer_name"`
	ReviewedAt          *time.Time    `json:"reviewed_at"`
	
	CreatedAt           time.Time     `json:"created_at"`
}

// SystemConfig 系统全局配置项
type SystemConfig struct {
	Key         string    `gorm:"primaryKey;size:64" json:"key"`
	Value       string    `gorm:"type:text;not null" json:"value"`
	Description string    `gorm:"type:text" json:"description"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// User 系统用户模型（支持预置账号密码登录与飞书 SSO）
type User struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;uniqueIndex" json:"username"` // 登录用户名 (如 admin, developer, tester)
	PasswordHash string    `gorm:"size:255" json:"-"`                  // 密码哈希 (隐藏)
	OpenID       string    `gorm:"size:128;index" json:"open_id"`       // 飞书 open_id (本地用户可为空)
	UnionID      string    `gorm:"size:128;index" json:"union_id"`     // 飞书 union_id
	Name         string    `gorm:"size:128;not null" json:"name"`      // 姓名/昵称
	EnName       string    `gorm:"size:128" json:"en_name"`           // 英文名
	AvatarURL    string    `gorm:"type:text" json:"avatar_url"`        // 头像地址
	Email        string    `gorm:"size:128" json:"email"`             // 邮箱
	Mobile       string    `gorm:"size:64" json:"mobile"`             // 手机号
	Role         string    `gorm:"size:32;default:'admin'" json:"role"` // 角色: admin, developer, tester
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// MatchScenarioTags 校验资源关联的场景标签与指定场景的标签是否匹配
// 规则：
// 1. 若 resourceTags 包含 "*" 或 "global" 则对所有场景通用，返回 true；
// 2. 若 scenarioTags 为空或包含 "*" 则无限制，返回 true；
// 3. 若 resourceTags 与 scenarioTags 存在至少一个非空交集（忽略大小写与前后空格），返回 true；
// 4. 其它情况返回 false。
func MatchScenarioTags(resourceTagsJSON, scenarioTagsJSON string) bool {
	var resTags, scnTags []string
	_ = json.Unmarshal([]byte(resourceTagsJSON), &resTags)
	_ = json.Unmarshal([]byte(scenarioTagsJSON), &scnTags)

	// 若未指定资源标签或资源显式包含通配符，视为通用
	if len(resTags) == 0 {
		return true
	}
	for _, t := range resTags {
		tTrim := strings.TrimSpace(strings.ToLower(t))
		if tTrim == "*" || tTrim == "global" {
			return true
		}
	}

	// 若场景本身未打标签或场景包含通配符，视为无场景约束
	if len(scnTags) == 0 {
		return true
	}
	for _, st := range scnTags {
		stTrim := strings.TrimSpace(strings.ToLower(st))
		if stTrim == "*" || stTrim == "global" {
			return true
		}
	}

	// 计算标签交集
	tagSet := make(map[string]bool)
	for _, t := range resTags {
		tTrim := strings.TrimSpace(strings.ToLower(t))
		if tTrim != "" {
			tagSet[tTrim] = true
		}
	}

	for _, st := range scnTags {
		stTrim := strings.TrimSpace(strings.ToLower(st))
		if stTrim != "" && tagSet[stTrim] {
			return true
		}
	}

	return false
}
