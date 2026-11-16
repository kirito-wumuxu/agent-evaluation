# 1. Agent 评测系统核心架构与运行模型

## 上下文
在设计基于 Golang + Gin + Goja + SQLite3 + React 的轻量级 Agent 评测系统时，面临以下架构与领域决策：
1. 评测配置的实体复用粒度与绑定关系；
2. Goja (JavaScript) 脚本运行时的边界与执行粒度；
3. SQLite3 在批量评测网络 I/O 场景下的并发读写与任务调度；
4. 人工复核与机器评测得分的存储与核对模式。

## 决策
1. **实体解耦与组装式任务 (Composition Model)**：
   - 确立 `Environment`（环境配置）、`Scenario`（场景脚本）、`Dataset`（用例集包含 TestCase）三者相互独立。
   - `EvaluationTask` 充当运行配方（Recipe），组合 `1个 Environment + 1个 Scenario + 1个 Dataset + 1..N个 Evaluator`，实现测试用例与环境的最高复用性。
2. **Goja 单用例沙箱执行契约 (Per-Case Goja Sandbox)**：
   - Goja JS 脚本仅承担单 Case 粒度的被测端适配职责：`function execute(env, input) -> output`。
   - 并发控制、批处理迭代、超时控制（Context Timeout）均由 Go 宿主层接管。
   - Go 宿主向 JS 沙箱注入 `http`（内置请求代理）与 `console.log`（运行日志截获）。
3. **Goroutine Worker Pool + SQLite WAL 调度**：
   - 任务以异步后台协程池（Worker Pool，默认并发 3~5）运行。
   - SQLite 开启 `PRAGMA journal_mode=WAL;`，使用统一连接池配置避免 `database is locked` 错误。
4. **人工复核双轨留痕 (Dual-Track Review Record)**：
   - 每个用例运行记录独立保存 `machine_*`（机器评估结果）与 `human_*`（人工复核修正结果）。
   - 保留评测基线数据的同时支持人工打标修正，支持后续 LLM-as-a-Judge Prompt 质量对齐。

## 后续影响
- 评测任务创建灵活，多环境、多场景可自由交叉测试。
- 保证长时间批量网络请求不阻塞 Web 接口与主线程，同时避免高并发击垮 SQLite 和被测 Agent。
