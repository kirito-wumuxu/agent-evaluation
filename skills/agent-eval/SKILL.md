---
name: agent-eval
description: 供编码 Agent (如 Claude Code) 在编写或优化 Prompt 与代码时，调用评测系统拉起评测任务、自动轮询进度并获取 Bad Case 归因诊断报告以实现自优化循环。
---

# Agent 自动化评测与 Prompt 自优化 Skill

本 Skill 为编码智能体（Claude Code、Cursor、Windsurf、Antigravity 等）提供评测系统集成接口。无需依赖任何第三方库，基于纯 Python 3 标准库脚本与本地评测系统打通。

## 适用场景

1. **Prompt 自优化循环 (TDD 模式)**：修改 Prompt 或逻辑后，自动触发评测，根据失败案例（Bad Cases）的期望与实际输出差异、裁判扣分理由，反思并优化 Prompt；
2. **失败用例极速复测 (`--failed-only`)**：针对上一次评测未通过的用例进行精准回归，秒级验证修改是否解决了已知问题，避免全量回归的耗时与噪声；
3. **快速抽样验证 (`--limit`)**：在迭代探索期，限制仅运行前 N 条用例快速出分。

---

## 常用命令参考

所有的操作均通过 Python 3 脚本执行：`skills/agent-eval/eval_client.py`。

### 1. 发现可用评测任务
```bash
python3 skills/agent-eval/eval_client.py list
```
输出已配置的评测任务列表、场景名称、用例集大小及最近一次运行的通过率。

### 2. 执行全量评测并自动等待诊断报告
```bash
python3 skills/agent-eval/eval_client.py run --task <TASK_ID> --wait
```
- 自动触发评测任务；
- 在终端打印动态进度条（如 `[████████░░] 80% (8/10)`）；
- 任务执行完毕后，自动打印结构化的 Markdown 诊断报告。

### 3. 精准回归上次失败用例 (自优化核心推荐)
```bash
python3 skills/agent-eval/eval_client.py run --task <TASK_ID> --failed-only --wait
```
- 仅提取上一次运行中未通过或抛错的用例进行执行；
- 若上次全部通过，将提示无需复测。

### 4. 快速抽样评测
```bash
python3 skills/agent-eval/eval_client.py run --task <TASK_ID> --limit 5 --wait
```
- 仅执行前 5 条用例，适合大规模用例集的快速验证。

### 5. 异步执行与分步查询
```bash
# 1. 异步触发
python3 skills/agent-eval/eval_client.py run --task <TASK_ID>
# 返回: Run #15

# 2. 查询进度
python3 skills/agent-eval/eval_client.py status --run 15

# 3. 获取诊断报告
python3 skills/agent-eval/eval_client.py summary --run 15
```

---

## 编码 Agent 自优化 Prompt 标准工作流

当用户要求您调优某个 Agent 的 Prompt 时，推荐遵循以下四步闭环：

1. **第一步（Baseline 基线测试）**：
   运行 `python3 skills/agent-eval/eval_client.py run --task <TASK_ID> --wait`，记录当前初始得分与失败项。
2. **第二步（Bad Cases 归因分析）**：
   阅读输出报告中 `❌ 失败/未通过用例归因明细`：
   - 观察输入、期望输出与模型实际输出的语义差距；
   - 观察裁判扣分理由（例如：“缺少某个必要字段”、“未按指定JSON格式输出”、“语气不符合要求”）。
3. **第三步（定向优化 Prompt）**：
   修改目标代码或 Prompt，针对裁判指出的缺陷在 System Prompt 或 Few-Shot 中增加约束规则。
4. **第四步（快速回归验证）**：
   运行 `python3 skills/agent-eval/eval_client.py run --task <TASK_ID> --failed-only --wait`：
   - 验证原本失败的用例是否已全部通过；
   - 全部转绿后，再次运行全量评测（不带 `--failed-only`），确保未引入意外退化！
