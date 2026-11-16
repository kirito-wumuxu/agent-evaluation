package evaluator

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"agent-evaluation/internal/model"

	"github.com/dop251/goja"
)

// EvalResult 单个评测模块的评测结果
type EvalResult struct {
	EvaluatorID   uint    `json:"evaluator_id"`
	EvaluatorName string  `json:"evaluator_name"`
	Type          string  `json:"type"`
	Weight        float64 `json:"weight"`
	Score         float64 `json:"score"`  // 0 - 100
	Passed        bool    `json:"passed"` // 是否合格
	Reason        string  `json:"reason"` // 打分或判定理由
}

// Evaluator 评测模块通用接口
type Evaluator interface {
	Evaluate(ctx context.Context, input, output, expected string) (*EvalResult, error)
}

// NewEvaluatorFromModel 根据数据库实体构建 Evaluator 实例 (仅支持 LLM Judge 和 Script Judge)
func NewEvaluatorFromModel(e *model.Evaluator, weight float64, globalConfigs map[string]string) (Evaluator, error) {
	if weight <= 0 {
		weight = 1.0
	}

	switch e.Type {
	case model.EvaluatorTypeLLMJudge:
		var cfg struct {
			PromptTemplate string `json:"prompt_template"`
			Model          string `json:"model"`
			BaseURL        string `json:"base_url"`
			APIKey         string `json:"api_key"`
		}
		_ = json.Unmarshal([]byte(e.ConfigJSON), &cfg)

		baseURL := cfg.BaseURL
		if baseURL == "" && globalConfigs != nil {
			baseURL = globalConfigs["judge_llm_base_url"]
		}
		apiKey := cfg.APIKey
		if apiKey == "" && globalConfigs != nil {
			apiKey = globalConfigs["judge_llm_api_key"]
		}
		modelName := cfg.Model
		if modelName == "" && globalConfigs != nil {
			modelName = globalConfigs["judge_llm_model"]
		}
		if modelName == "" {
			modelName = "gpt-4o-mini"
		}

		return &LLMJudgeEvaluator{
			ID:             e.ID,
			Name:           e.Name,
			Weight:         weight,
			PromptTemplate: cfg.PromptTemplate,
			Model:          modelName,
			BaseURL:        baseURL,
			APIKey:         apiKey,
		}, nil

	case model.EvaluatorTypeScript:
		var cfg struct {
			Script string `json:"script"`
		}
		_ = json.Unmarshal([]byte(e.ConfigJSON), &cfg)
		return &ScriptEvaluator{
			ID:     e.ID,
			Name:   e.Name,
			Weight: weight,
			Script: cfg.Script,
		}, nil

	default:
		return nil, fmt.Errorf("未知的评测器类型: %s (仅支持 %s 和 %s)", e.Type, model.EvaluatorTypeLLMJudge, model.EvaluatorTypeScript)
	}
}

// -------------------------------------------------------------
// 1. LLM Judge 模板解析器 (Prompt Template Interpolation)
// -------------------------------------------------------------

// RenderPromptTemplate 渲染 LLM Judge 的 Prompt 模板
// 支持从期望 (expected)、实际 (actual/output) 及输入 (input) 的 JSON 中提取字段
// 语法形式支持：
//   - 全局占位符：{input}, {{input}}, {output}, {{output}}, {actual}, {{actual}}, {expected}, {{expected}}, {time}, {{time}}
//   - 结构化点号语法：{expected.xxx}, {{expected.xxx}}, {actual.xxx}, {{actual.xxx}}, {output.xxx}, {{output.xxx}}, {input.xxx}, {{input.xxx}}
func RenderPromptTemplate(template, input, output, expected string) string {
	prompt := template

	// 1. 尝试反序列化 JSON 数据
	var inputMap, outputMap, expectedMap map[string]interface{}
	_ = json.Unmarshal([]byte(input), &inputMap)
	_ = json.Unmarshal([]byte(output), &outputMap)
	_ = json.Unmarshal([]byte(expected), &expectedMap)

	// 2. 基础占位符替换
	currentTime := time.Now().Format("2006-01-02 15:04:05")
	prompt = strings.ReplaceAll(prompt, "{{input}}", input)
	prompt = strings.ReplaceAll(prompt, "{input}", input)
	prompt = strings.ReplaceAll(prompt, "{{output}}", output)
	prompt = strings.ReplaceAll(prompt, "{output}", output)
	prompt = strings.ReplaceAll(prompt, "{{actual}}", output)
	prompt = strings.ReplaceAll(prompt, "{actual}", output)
	prompt = strings.ReplaceAll(prompt, "{{expected}}", expected)
	prompt = strings.ReplaceAll(prompt, "{expected}", expected)
	prompt = strings.ReplaceAll(prompt, "{{time}}", currentTime)
	prompt = strings.ReplaceAll(prompt, "{time}", currentTime)

	// 3. 正则捕获 {target.path} 或 {{target.path}}
	re := regexp.MustCompile(`\{{1,2}(expected|actual|output|input)\.([a-zA-Z0-9_\-\.]+)\}{1,2}`)
	prompt = re.ReplaceAllStringFunc(prompt, func(match string) string {
		sub := re.FindStringSubmatch(match)
		if len(sub) < 3 {
			return match
		}
		target := sub[1]
		path := sub[2]

		var targetMap map[string]interface{}
		switch target {
		case "expected":
			targetMap = expectedMap
		case "actual", "output":
			targetMap = outputMap
		case "input":
			targetMap = inputMap
		}

		if targetMap == nil {
			return ""
		}

		parts := strings.Split(path, ".")
		var current interface{} = targetMap
		for _, part := range parts {
			if m, ok := current.(map[string]interface{}); ok {
				if val, exists := m[part]; exists {
					current = val
				} else {
					return ""
				}
			} else {
				return ""
			}
		}

		switch v := current.(type) {
		case string:
			return v
		case nil:
			return ""
		default:
			b, err := json.Marshal(v)
			if err == nil {
				return string(b)
			}
			return fmt.Sprintf("%v", v)
		}
	})

	return prompt
}

// -------------------------------------------------------------
// 2. LLMJudgeEvaluator (大模型裁判)
// -------------------------------------------------------------

type LLMJudgeEvaluator struct {
	ID             uint
	Name           string
	Weight         float64
	PromptTemplate string
	Model          string
	BaseURL        string
	APIKey         string
}

func (l *LLMJudgeEvaluator) Evaluate(ctx context.Context, input, output, expected string) (*EvalResult, error) {
	// 模板变量渲染
	prompt := RenderPromptTemplate(l.PromptTemplate, input, output, expected)

	// 若未配置 API Key 或 Base URL，提供基于文本/字段包含的降级模拟裁判，确保链路不中断
	if l.APIKey == "" || l.BaseURL == "" {
		mockPassed := strings.Contains(strings.TrimSpace(output), strings.TrimSpace(expected))
		if !mockPassed && expected != "" {
			// 若 expected 是 JSON，检查关键字段值是否包含在 output 中
			var expMap map[string]interface{}
			if err := json.Unmarshal([]byte(expected), &expMap); err == nil && len(expMap) > 0 {
				matchedFieldCount := 0
				for _, v := range expMap {
					vStr := fmt.Sprintf("%v", v)
					if vStr != "" && strings.Contains(output, vStr) {
						matchedFieldCount++
					}
				}
				if matchedFieldCount > 0 && float64(matchedFieldCount)/float64(len(expMap)) >= 0.6 {
					mockPassed = true
				}
			}
		}

		mockScore := 60.0
		if mockPassed {
			mockScore = 90.0
		}
		return &EvalResult{
			EvaluatorID:   l.ID,
			EvaluatorName: l.Name,
			Type:          string(model.EvaluatorTypeLLMJudge),
			Weight:        l.Weight,
			Score:         mockScore,
			Passed:        mockPassed,
			Reason:        "[Mock LLM Judge] 系统未配置 Judge LLM API Key，基于模板渲染后降级判定",
		}, nil
	}

	// 请求 OpenAI 兼容接口
	apiEndpoint := strings.TrimRight(l.BaseURL, "/") + "/chat/completions"
	reqPayload := map[string]interface{}{
		"model": l.Model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.0,
	}

	reqBytes, _ := json.Marshal(reqPayload)
	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewReader(reqBytes))
	if err != nil {
		return nil, fmt.Errorf("创建 LLM 请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+l.APIKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("LLM Judge 网络请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 LLM 响应体失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM API 返回状态码 %d: %s", resp.StatusCode, string(respBytes))
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &chatResp); err != nil || len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("解析 LLM 响应结构失败: %s", string(respBytes))
	}

	rawContent := strings.TrimSpace(chatResp.Choices[0].Message.Content)
	// 清理可能包含的 Markdown ```json 代码块包裹
	cleanJSON := rawContent
	if strings.HasPrefix(cleanJSON, "```") {
		lines := strings.Split(cleanJSON, "\n")
		if len(lines) >= 3 {
			cleanJSON = strings.Join(lines[1:len(lines)-1], "\n")
		}
	}

	var judgeResult struct {
		Score  float64 `json:"score"`
		Passed bool    `json:"passed"`
		Reason string  `json:"reason"`
	}
	if err := json.Unmarshal([]byte(cleanJSON), &judgeResult); err != nil {
		return &EvalResult{
			EvaluatorID:   l.ID,
			EvaluatorName: l.Name,
			Type:          string(model.EvaluatorTypeLLMJudge),
			Weight:        l.Weight,
			Score:         0,
			Passed:        false,
			Reason:        fmt.Sprintf("LLM 裁判未按标准 JSON 格式输出，原始内容: %s", rawContent),
		}, nil
	}

	return &EvalResult{
		EvaluatorID:   l.ID,
		EvaluatorName: l.Name,
		Type:          string(model.EvaluatorTypeLLMJudge),
		Weight:        l.Weight,
		Score:         judgeResult.Score,
		Passed:        judgeResult.Passed,
		Reason:        judgeResult.Reason,
	}, nil
}

// -------------------------------------------------------------
// 3. ScriptEvaluator (Script Judge 自定义 JS 脚本函数评测器)
// -------------------------------------------------------------

type ScriptEvaluator struct {
	ID     uint
	Name   string
	Weight float64
	Script string
}

func (s *ScriptEvaluator) Evaluate(ctx context.Context, input, output, expected string) (*EvalResult, error) {
	vm := goja.New()

	// 注入 console.log 便于调试
	_ = vm.Set("console", map[string]interface{}{
		"log": func(call goja.FunctionCall) goja.Value {
			var parts []string
			for _, arg := range call.Arguments {
				parts = append(parts, fmt.Sprintf("%v", arg.Export()))
			}
			log.Printf("[ScriptJudge] %s", strings.Join(parts, " "))
			return goja.Undefined()
		},
	})

	// 超时控制
	stopCh := make(chan struct{})
	defer close(stopCh)
	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt(errors.New("评测脚本执行超时"))
		case <-stopCh:
		}
	}()

	// 注入原始数据与预解析的对象（如为合法的 JSON）
	var inputObj, outputObj, expectedObj interface{}
	_ = json.Unmarshal([]byte(input), &inputObj)
	_ = json.Unmarshal([]byte(output), &outputObj)
	_ = json.Unmarshal([]byte(expected), &expectedObj)

	_ = vm.Set("inputRaw", input)
	_ = vm.Set("outputRaw", output)
	_ = vm.Set("expectedRaw", expected)
	_ = vm.Set("inputObj", inputObj)
	_ = vm.Set("outputObj", outputObj)
	_ = vm.Set("expectedObj", expectedObj)

	// 注入 module 和 exports 兼容 CommonJS 规范写法
	exportsObj := vm.NewObject()
	_ = vm.Set("exports", exportsObj)
	moduleObj := vm.NewObject()
	_ = moduleObj.Set("exports", exportsObj)
	_ = vm.Set("module", moduleObj)

	_, err := vm.RunString(s.Script)
	if err != nil {
		return nil, fmt.Errorf("评测脚本语法错误: %w", err)
	}

	evalFn, err := resolveEvalFunction(vm)
	if err != nil {
		return nil, err
	}

	resVal, err := evalFn(goja.Undefined(), vm.ToValue(input), vm.ToValue(output), vm.ToValue(expected))
	if err != nil {
		return nil, fmt.Errorf("执行 evaluate() 函数失败: %w", err)
	}

	var parsed struct {
		Score  float64 `json:"score"`
		Passed bool    `json:"passed"`
		Reason string  `json:"reason"`
	}

	exported := resVal.Export()
	b, err := json.Marshal(exported)
	if err != nil {
		return nil, fmt.Errorf("序列化评测脚本返回值失败: %w", err)
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return nil, fmt.Errorf("评测脚本返回值格式错误 (必须包含 score, passed, reason): %w", err)
	}

	if parsed.Score < 0 {
		parsed.Score = 0
	}
	if parsed.Score > 100 {
		parsed.Score = 100
	}

	return &EvalResult{
		EvaluatorID:   s.ID,
		EvaluatorName: s.Name,
		Type:          string(model.EvaluatorTypeScript),
		Weight:        s.Weight,
		Score:         parsed.Score,
		Passed:        parsed.Passed,
		Reason:        parsed.Reason,
	}, nil
}

// resolveEvalFunction 严格解析评测脚本中的 evaluate 函数，不添加任何 fallback
func resolveEvalFunction(vm *goja.Runtime) (goja.Callable, error) {
	val := vm.Get("evaluate")
	if val == nil || goja.IsNull(val) || goja.IsUndefined(val) {
		return nil, errors.New("评测脚本未定义 evaluate(input, output, expected) 函数。\n正确编写示例：\nfunction evaluate(input, output, expected) {\n  return {\n    score: 100,\n    passed: true,\n    reason: \"评测理由说明\"\n  };\n}")
	}

	fn, ok := goja.AssertFunction(val)
	if !ok {
		return nil, errors.New("evaluate 标识符不是有效的函数")
	}

	return fn, nil
}

// -------------------------------------------------------------
// 4. 聚合器 (加权平均得分 + 一票否决通过判定)
// -------------------------------------------------------------

// Aggregate 聚合单条用例中多个 Evaluator 的结果
func Aggregate(results []*EvalResult) (finalScore float64, finalPassed bool) {
	if len(results) == 0 {
		return 0, false
	}

	var totalWeightedScore float64
	var totalWeight float64
	allPassed := true

	for _, res := range results {
		w := res.Weight
		if w <= 0 {
			w = 1.0
		}
		totalWeightedScore += res.Score * w
		totalWeight += w

		if !res.Passed {
			allPassed = false
		}
	}

	if totalWeight > 0 {
		finalScore = totalWeightedScore / totalWeight
	}
	finalPassed = allPassed
	return finalScore, finalPassed
}
