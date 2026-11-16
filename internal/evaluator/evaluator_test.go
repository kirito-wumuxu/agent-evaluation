package evaluator

import (
	"context"
	"strings"
	"testing"
)

func TestRenderPromptTemplate_JSONFields(t *testing.T) {
	template := `评估任务：
- 标题期望: {expected.task_title}
- 标题实际: {{actual.task_title}}
- 触发期望: {expected.trigger_dsl}
- 触发实际: {output.trigger_dsl}
- 输入目标: {input.goal_text}
- 时间: {time}`

	input := `{"goal_text":"每日播报世界杯"}`
	expected := `{"task_title":"世界杯播报","trigger_dsl":"0 0 10 * * ?"}`
	actual := `{"task_title":"世界杯资讯","trigger_dsl":"0 0 10 * * ?"}`

	rendered := RenderPromptTemplate(template, input, actual, expected)

	if !strings.Contains(rendered, "标题期望: 世界杯播报") {
		t.Errorf("expected task_title not rendered correctly: %s", rendered)
	}
	if !strings.Contains(rendered, "标题实际: 世界杯资讯") {
		t.Errorf("actual task_title not rendered correctly: %s", rendered)
	}
	if !strings.Contains(rendered, "触发期望: 0 0 10 * * ?") {
		t.Errorf("expected trigger_dsl not rendered correctly: %s", rendered)
	}
	if !strings.Contains(rendered, "触发实际: 0 0 10 * * ?") {
		t.Errorf("actual trigger_dsl not rendered correctly: %s", rendered)
	}
	if !strings.Contains(rendered, "输入目标: 每日播报世界杯") {
		t.Errorf("input goal_text not rendered correctly: %s", rendered)
	}
}

func TestScriptEvaluator_FunctionExecution(t *testing.T) {
	script := `
function evaluate(input, output, expected) {
  var exp = JSON.parse(expected);
  var act = JSON.parse(output);
  var match = exp.task_type === act.task_type;
  return {
    score: match ? 100 : 0,
    passed: match,
    reason: match ? "任务类型一致" : "任务类型不符"
  };
}
`
	ev := &ScriptEvaluator{
		ID:     1,
		Name:   "脚本测试",
		Weight: 1.0,
		Script: script,
	}

	input := `{}`
	expected := `{"task_type":"SCHEDULED"}`
	actual := `{"task_type":"SCHEDULED"}`

	res, err := ev.Evaluate(context.Background(), input, actual, expected)
	if err != nil {
		t.Fatalf("Evaluate error: %v", err)
	}
	if !res.Passed || res.Score != 100 {
		t.Errorf("Expected 100 passed, got %v (%s)", res.Score, res.Reason)
	}
}

func TestScriptEvaluator_StrictEvaluateNoFallback(t *testing.T) {
	// 1. evaluate 函数正常执行
	evEvaluate := &ScriptEvaluator{
		ID:     2,
		Name:   "evaluate正常执行",
		Weight: 1.0,
		Script: `function evaluate(input, output, expected) {
			return { score: 95, passed: true, reason: "evaluate 执行成功" };
		}`,
	}
	res, err := evEvaluate.Evaluate(context.Background(), "in", "out", "exp")
	if err != nil || res.Score != 95 {
		t.Fatalf("failed evaluate: %v, res: %+v", err, res)
	}

	// 2. 误写为 execute(...) 时，不再提供 fallback，应明确报错
	evExecute := &ScriptEvaluator{
		ID:     3,
		Name:   "execute无fallback报错",
		Weight: 1.0,
		Script: `function execute(input, output, expected) {
			return { score: 88, passed: true, reason: "不应被识别" };
		}`,
	}
	_, err = evExecute.Evaluate(context.Background(), "in", "out", "exp")
	if err == nil || !strings.Contains(err.Error(), "评测脚本未定义 evaluate") {
		t.Fatalf("expected evaluate required error for execute alias, got: %v", err)
	}

	// 3. const evaluate = (...) => ... 全局箭头函数支持
	evArrow := &ScriptEvaluator{
		ID:     4,
		Name:   "arrow evaluate支持",
		Weight: 1.0,
		Script: `const evaluate = (input, output, expected) => ({
			score: 100,
			passed: true,
			reason: "箭头函数识别成功"
		});`,
	}
	res, err = evArrow.Evaluate(context.Background(), "in", "out", "exp")
	if err != nil || res.Score != 100 {
		t.Fatalf("failed arrow function: %v, res: %+v", err, res)
	}

	// 4. 未定义有效 evaluate 函数时，返回清晰指引错误
	evInvalid := &ScriptEvaluator{
		ID:     5,
		Name:   "无函数脚本",
		Weight: 1.0,
		Script: `var a = 1; var b = 2;`,
	}
	_, err = evInvalid.Evaluate(context.Background(), "in", "out", "exp")
	if err == nil || !strings.Contains(err.Error(), "评测脚本未定义 evaluate") {
		t.Fatalf("expected clear guide error, got: %v", err)
	}
}
