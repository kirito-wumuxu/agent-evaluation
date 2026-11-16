package db

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"agent-evaluation/internal/model"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDB 初始化数据库连接、开启 WAL 模式、自动迁移表结构与预填种子数据
func InitDB(dbPath string) (*gorm.DB, error) {
	if dbPath == "" {
		dbPath = "data/eval.db"
	}

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建数据库目录失败: %w", err)
	}

	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)", dbPath)
	
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("连接 SQLite 数据库失败: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// SQLite 在写操作下建议保持 1 个活跃连接池限制，避免并发写锁竞争
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// 自动迁移
	err = db.AutoMigrate(
		&model.Environment{},
		&model.Scenario{},
		&model.Dataset{},
		&model.TestCase{},
		&model.Evaluator{},
		&model.EvaluationTask{},
		&model.RunRecord{},
		&model.RunRecordItem{},
		&model.SystemConfig{},
		&model.User{},
	)
	if err != nil {
		return nil, fmt.Errorf("数据库表结构迁移失败: %w", err)
	}

	// 存量历史数据场景标签平滑补齐 (默认兼容全局通用 "*")
	db.Model(&model.Environment{}).Where("scenario_tags_json IS NULL OR scenario_tags_json = '' OR scenario_tags_json = '[]'").Update("scenario_tags_json", `["*"]`)
	db.Model(&model.Scenario{}).Where("tags_json IS NULL OR tags_json = '' OR tags_json = '[]'").Update("tags_json", `["*"]`)
	db.Model(&model.Dataset{}).Where("scenario_tags_json IS NULL OR scenario_tags_json = '' OR scenario_tags_json = '[]'").Update("scenario_tags_json", `["*"]`)
	db.Model(&model.Evaluator{}).Where("scenario_tags_json IS NULL OR scenario_tags_json = '' OR scenario_tags_json = '[]'").Update("scenario_tags_json", `["*"]`)

	DB = db
	seedDefaultData(db)
	return db, nil
}

// seedDefaultData 初始化默认系统配置与示例评测资产
func seedDefaultData(db *gorm.DB) {
	// 1. 初始化系统全局配置
	defaultConfigs := []model.SystemConfig{
		{Key: "judge_llm_base_url", Value: "https://api.openai.com/v1", Description: "默认大模型裁判 API Base URL"},
		{Key: "judge_llm_api_key", Value: "", Description: "默认大模型裁判 API Key"},
		{Key: "judge_llm_model", Value: "gpt-4o-mini", Description: "默认大模型裁判模型名称"},
		{Key: "default_concurrency", Value: "3", Description: "评测任务默认执行并发数"},
		{Key: "default_timeout_seconds", Value: "30", Description: "单用例默认网络请求超时时间 (秒)"},
		{Key: "feishu_sso_enabled", Value: "false", Description: "是否启用飞书 SSO 登录 (true/false)"},
		{Key: "feishu_app_id", Value: "", Description: "飞书自建应用 App ID (以 cli_ 开头)"},
		{Key: "feishu_app_secret", Value: "", Description: "飞书自建应用 App Secret"},
		{Key: "feishu_redirect_uri", Value: "", Description: "飞书 OAuth 回调重定向 URL (如 http://localhost:8080/api/v1/auth/feishu/callback)"},
		{Key: "jwt_secret", Value: "eval-jwt-secret-" + time.Now().Format("20060102150405"), Description: "JWT 会话签名密钥"},
		{Key: "openapi_api_key", Value: "eval_ak_" + generateRandomPassword(24), Description: "OpenAPI 开放接口长效调用密钥 (供 Agent 与外部 Skill 调用)"},
	}

	for _, cfg := range defaultConfigs {
		var count int64
		db.Model(&model.SystemConfig{}).Where("key = ?", cfg.Key).Count(&count)
		if count == 0 {
			cfg.UpdatedAt = time.Now()
			db.Create(&cfg)
		}
	}

	// 初始化预置 3 个账号 (admin, developer, tester)
	seedPresetUsers(db)

	// 自动兼容补充数据集动态列配置
	db.Model(&model.Dataset{}).Where("columns_json = '' OR columns_json = '[]' OR columns_json IS NULL").
		Update("columns_json", `[{"key":"prompt","label":"输入提示词","type":"input"},{"key":"expected","label":"期望输出","type":"expected"},{"key":"category","label":"意图分类","type":"metadata"},{"key":"priority","label":"优先级","type":"metadata"}]`)

	// 2. 初始化默认示例环境配置
	var envCount int64
	db.Model(&model.Environment{}).Count(&envCount)
	if envCount == 0 {
		mockEnvVars := map[string]interface{}{
			"BASE_URL":   "https://httpbin.org",
			"API_KEY":    "demo-secret-key-12345",
			"AGENT_NAME": "SupportBot-v1",
		}
		varsBytes, _ := json.MarshalIndent(mockEnvVars, "", "  ")

		demoEnv := model.Environment{
			Name:          "Demo Mock 环境",
			Description:   "用于快速测试与调试场景脚本的默认模拟环境",
			VariablesJSON: string(varsBytes),
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		db.Create(&demoEnv)

		// 3. 初始化默认示例场景脚本 (Goja JS)
		demoScript := `/**
 * execute(env, input)
 * @param {Object} env 环境变量对象
 * @param {any} input 测试用例输入
 * @returns {string} Agent 输出结果
 */
function execute(env, input) {
    console.log("正在请求环境地址:", env.BASE_URL);
    console.log("用例输入提示词:", input.prompt || input);

    // 示例调用：模拟请求 Agent 接口 (这里借用 httpbin 进行回显测试)
    const resp = http.post(env.BASE_URL + "/post", {
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.API_KEY
        },
        body: JSON.stringify({
            agent: env.AGENT_NAME,
            prompt: input.prompt || input
        }),
        timeout_seconds: 15
    });

    if (resp.status_code !== 200) {
        throw new Error("HTTP 请求异常: " + resp.status_code + " - " + resp.body);
    }

    // 模拟从 Agent 响应中解析回答：
    // 根据输入内容智能返回模拟回答，方便开箱演练评测
    const promptStr = String(input.prompt || input);
    if (promptStr.indexOf("退款") !== -1) {
        return "您的退款申请已受理，款项将在1至3个工作日内原路退回。";
    } else if (promptStr.indexOf("客服电话") !== -1) {
        return "官方客服电话为：400-888-9999，工作时间 9:00 - 18:00。";
    }
    return "您好，我是智能客服助手，请问有什么可以帮您？";
}`

		demoScenario := model.Scenario{
			Name:        "客服智能体标准问答场景",
			Description: "调用客服 Agent API 并解析最终回复文本的标准场景脚本",
			Script:      demoScript,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		db.Create(&demoScenario)

		asyncScript := `/**
 * execute(env, input)
 * 异步任务轮询模式:
 * 1. POST 发起异步生成任务，获取 task_id
 * 2. 循环使用 sleep(ms) 挂起等待并 GET 轮询任务状态
 * 3. 待状态为 SUCCESS 时提取真实输出并返回
 */
function execute(env, input) {
    const promptText = typeof input === 'string' ? input : (input.prompt || JSON.stringify(input));
    console.log("【1. 提交异步任务】目标环境:", env.BASE_URL);

    // 1. 发起异步任务提交 (示例使用 httpbin 模拟)
    const submitResp = http.post(env.BASE_URL + "/post", {
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.API_KEY
        },
        body: JSON.stringify({
            action: "create_async_task",
            prompt: promptText
        }),
        timeout_seconds: 15
    });

    if (submitResp.status_code !== 200) {
        throw new Error("异步任务创建失败: " + submitResp.status_code + " - " + submitResp.body);
    }

    // 模拟获取异步任务 ID
    const taskId = "task_" + Date.now();
    console.log("异步任务已创建，生成 TaskID:", taskId);

    // 2. 轮询结果接口 (最大等待 60 秒，每次间隔 1.5 秒)
    const maxWaitSeconds = 60;
    const pollIntervalMs = 1500;
    const startTime = Date.now();
    let pollCount = 0;

    while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
        pollCount++;
        // 使用内置 sleep 挂起等待，释放 CPU
        sleep(pollIntervalMs);

        console.log("第 " + pollCount + " 次轮询查询状态, TaskID:", taskId);
        
        // 模拟调用查询接口
        const queryResp = http.get(env.BASE_URL + "/get?task_id=" + taskId, {
            headers: { "Authorization": "Bearer " + env.API_KEY },
            timeout_seconds: 10
        });

        if (queryResp.status_code === 200) {
            // 这里根据实际返回的 status 字段判断；本示例模拟轮询 2 次后完成返回
            if (pollCount >= 2) {
                console.log("异步任务已处理完毕，成功获取最终结果");
                if (promptText.indexOf("退款") !== -1) {
                    return "【异步处理完成】您的退款申请已审核通过，款项将在1至3个工作日内原路退回。";
                }
                return "【异步处理完成】查询已处理完毕，这是被测 Agent 的真实异步响应内容。";
            }
        }
    }

    throw new Error("异步任务轮询超时: 超过 " + maxWaitSeconds + " 秒未完成");
}`

		asyncScenario := model.Scenario{
			Name:        "长耗时智能体异步轮询场景",
			Description: "演示通过 POST 提交异步任务，结合 sleep 延时轮询 GET 状态接口获取真实返回的标准场景",
			Script:      asyncScript,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		db.Create(&asyncScenario)

		demoCols := `[
			{"key": "prompt", "label": "输入提示词", "type": "input"},
			{"key": "expected", "label": "期望输出", "type": "expected"},
			{"key": "category", "label": "意图分类", "type": "metadata"},
			{"key": "priority", "label": "优先级", "type": "metadata"}
		]`
		// 4. 初始化默认用例集与用例
		demoDataset := model.Dataset{
			Name:        "智能客服核心问答集",
			Description: "包含退款政策、客服热线与默认问候等核心意图的用例集",
			ColumnsJSON: demoCols,
			CaseCount:   3,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		db.Create(&demoDataset)

		cases := []model.TestCase{
			{
				DatasetID:      demoDataset.ID,
				InputData:      `{"prompt": "你好，我想咨询一下订单退款要多久才能到账？"}`,
				ExpectedOutput: "1至3个工作日",
				MetadataJSON:   `{"category": "退款咨询", "priority": "P0"}`,
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			},
			{
				DatasetID:      demoDataset.ID,
				InputData:      `{"prompt": "你们人工客服电话是多少号？"}`,
				ExpectedOutput: "400-888-9999",
				MetadataJSON:   `{"category": "联系方式", "priority": "P1"}`,
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			},
			{
				DatasetID:      demoDataset.ID,
				InputData:      `{"prompt": "在吗？"}`,
				ExpectedOutput: "智能客服助手",
				MetadataJSON:   `{"category": "常规寒暄", "priority": "P2"}`,
				CreatedAt:      time.Now(),
				UpdatedAt:      time.Now(),
			},
		}
		for _, c := range cases {
			db.Create(&c)
		}

		// 5. 初始化评测模块 (Script Judge 与 LLM Judge)
		scriptCode := `/**
 * evaluate(input, output, expected)
 * @returns { score: number, passed: boolean, reason: string }
 */
function evaluate(input, output, expected) {
    if (!output || output.trim() === "") {
        return { score: 0, passed: false, reason: "Agent 实际输出为空" };
    }
    const hasExpected = expected ? output.indexOf(expected) !== -1 : true;
    const isPolite = output.indexOf("您") !== -1 || output.indexOf("请") !== -1;
    
    let score = 50;
    if (hasExpected) score += 30;
    if (isPolite) score += 20;

    return {
        score: score,
        passed: hasExpected,
        reason: "关键信息命中: " + hasExpected + ", 礼貌用语得分: " + (isPolite ? 20 : 0)
    };
}`
		scriptEvalConfig := map[string]interface{}{
			"script": scriptCode,
		}
		scriptBytes, _ := json.Marshal(scriptEvalConfig)
		scriptEval := model.Evaluator{
			Name:        "客服礼貌与准确度脚本裁判",
			Description: "通过 JS 脚本对关键词命中率与礼貌敬语进行综合打分",
			Type:        model.EvaluatorTypeScript,
			ConfigJSON:  string(scriptBytes),
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		db.Create(&scriptEval)

		llmPrompt := `你是一名严格的 Agent 评测裁判。
请评估被测 Agent 的回答是否准确解答了用户的提问，并是否符合期望输出。

[用户输入]
{input}

[期望答案]
{expected}

[Agent实际回答]
{actual}

请严格按以下 JSON 格式返回你的评估结果（不要输出任何其他文本或 Markdown 标记）：
{
  "score": 85,
  "passed": true,
  "reason": "简述扣分或通过理由"
}`
		llmEvalConfig := map[string]interface{}{
			"prompt_template": llmPrompt,
			"model":           "", // 空代表使用系统默认配置
		}
		llmBytes, _ := json.Marshal(llmEvalConfig)
		llmEval := model.Evaluator{
			Name:        "大模型综合质量裁判 (LLM Judge)",
			Description: "使用大模型对输出相关性、准确性与逻辑性进行自然语言打分",
			Type:        model.EvaluatorTypeLLMJudge,
			ConfigJSON:  string(llmBytes),
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		db.Create(&llmEval)

		// 6. 初始化默认评测任务
		evalConfigs := []model.TaskEvaluatorConfig{
			{EvaluatorID: scriptEval.ID, Weight: 1.0},
			{EvaluatorID: llmEval.ID, Weight: 1.0},
		}
		evalConfigsBytes, _ := json.Marshal(evalConfigs)
		demoTask := model.EvaluationTask{
			Name:                 "客服智能体上线前冒烟评测",
			Description:          "针对客服智能体核心问答集进行端到端结果评估与自动化打分",
			ScenarioID:           demoScenario.ID,
			EnvironmentID:        demoEnv.ID,
			DatasetID:            demoDataset.ID,
			EvaluatorConfigsJSON: string(evalConfigsBytes),
			Concurrency:          2,
			MaxRetries:           1,
			CreatedAt:            time.Now(),
			UpdatedAt:            time.Now(),
		}
		db.Create(&demoTask)

		log.Println("[InitDB] 默认示例数据已成功写入 SQLite 数据库")
	}
}

// PresetAccount 预置账号元数据
type PresetAccount struct {
	Username    string
	Name        string
	Role        string
	Email       string
	Description string
}

// PresetAccounts 预置 3 个专属账号
var PresetAccounts = []PresetAccount{
	{Username: "admin", Name: "系统管理员", Role: "admin", Email: "admin@local", Description: "系统全局配置、评测流水线调度、全功能管理"},
	{Username: "developer", Name: "开发工程师", Role: "developer", Email: "developer@local", Description: "场景脚本编写、环境配置、用例与评测器开发"},
	{Username: "tester", Name: "测试质检员", Role: "tester", Email: "tester@local", Description: "用例集管理、发起评测任务、双轨人工质检复核"},
}

// generateRandomPassword 生成高可读随机密码 (8位，排除易混淆字符)
func generateRandomPassword(length int) string {
	const charset = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
	b := make([]byte, length)
	for i := range b {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "Pass@2026"
		}
		b[i] = charset[num.Int64()]
	}
	return string(b)
}

// seedPresetUsers 初始化或同步预置的 3 个账号
func seedPresetUsers(db *gorm.DB) {
	for _, acc := range PresetAccounts {
		cfgKey := fmt.Sprintf("preset_password_%s", acc.Username)
		var sysCfg model.SystemConfig
		err := db.Where("key = ?", cfgKey).First(&sysCfg).Error
		var plainPwd string
		if err != nil || sysCfg.Value == "" {
			plainPwd = generateRandomPassword(8)
			db.Save(&model.SystemConfig{
				Key:         cfgKey,
				Value:       plainPwd,
				Description: fmt.Sprintf("预置账号 %s 初始随机密码", acc.Username),
				UpdatedAt:   time.Now(),
			})
		} else {
			plainPwd = sysCfg.Value
		}

		hashBytes, _ := bcrypt.GenerateFromPassword([]byte(plainPwd), bcrypt.DefaultCost)
		hashStr := string(hashBytes)

		var user model.User
		err = db.Where("username = ?", acc.Username).First(&user).Error
		if err != nil {
			user = model.User{
				Username:     acc.Username,
				PasswordHash: hashStr,
				Name:         acc.Name,
				Role:         acc.Role,
				Email:        acc.Email,
				AvatarURL:    fmt.Sprintf("https://api.dicebear.com/7.x/bottts/svg?seed=%s", acc.Username),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
			db.Create(&user)
		} else {
			// 更新同步密码哈希和角色
			user.PasswordHash = hashStr
			user.Role = acc.Role
			db.Save(&user)
		}
	}
}

// PrintPresetCredentials 启动时将预置账号与随机密码格式化输出至控制台
func PrintPresetCredentials(db *gorm.DB) {
	fmt.Println()
	fmt.Println("==========================================================================================")
	fmt.Println("🔑 系统预置账号凭据 (Preset Account Credentials - Startup)")
	fmt.Println("------------------------------------------------------------------------------------------")
	fmt.Printf("%-12s | %-12s | %-12s | %s\n", "账号 (User)", "角色 (Role)", "密码 (Pass)", "权限说明与职责")
	fmt.Println("------------------------------------------------------------------------------------------")
	for _, acc := range PresetAccounts {
		cfgKey := fmt.Sprintf("preset_password_%s", acc.Username)
		var sysCfg model.SystemConfig
		_ = db.Where("key = ?", cfgKey).First(&sysCfg).Error
		fmt.Printf("%-12s | %-12s | %-12s | %s\n", acc.Username, acc.Role, sysCfg.Value, acc.Description)
	}
	fmt.Println("------------------------------------------------------------------------------------------")
	var openApiCfg model.SystemConfig
	_ = db.Where("key = ?", "openapi_api_key").First(&openApiCfg).Error
	fmt.Printf("🤖 OpenAPI Agent Key : %s\n", openApiCfg.Value)
	fmt.Printf("💡 接入提示: 本地 (localhost/127.0.0.1) 免鉴权直通; 远程调用请携带 Header: 'X-API-Key: %s'\n", openApiCfg.Value)
	fmt.Println("==========================================================================================")
	fmt.Println()
}

