# 2. 评测流水线调度、数据契约与交付形态

## 上下文
在明确了核心实体关系与 Goja 沙箱契约之后，需要进一步固化多 Evaluator 聚合计算规则、执行异常容错逻辑、环境配置数据结构、系统配置范围以及前后端打包集成方式。

## 决策
1. **多 Evaluator 权重加权与一票否决制 (Aggregation Rules)**：
   - 用例最终得分：各 Evaluator 的加权平均值 `score = sum(score_i * weight_i) / sum(weight_i)`。
   - 用例是否通过：逻辑与一票否决 `passed = passed_1 && passed_2 && ...`，任何一个评估器未通过即判定整体不通过。
2. **执行异常独立流转与容错 (Execution Error Handling)**：
   - 被测端超时、HTTP 5xx 或 Goja 运行时抛错时，单用例标记为 `ERROR` 状态。
   - 阻断后续 Evaluator 评估，避免错误堆栈污染评估指标或白白消耗 LLM Judge Token。
   - 支持任务级配置重试次数（`max_retries: 0~3`）。
3. **环境配置采用自由 JSON 文本 (Free-Form JSON Environment)**：
   - 现阶段保持轻量实用，环境配置中 `variables` 存储为自由 JSON 字符串（例如 `{"BASE_URL": "...", "API_KEY": "..."}`）。
   - Goja 脚本执行时直接解析该 JSON 并注入为 `env` 变量对象。不引入额外的脱敏拆表复杂度。
4. **系统配置采用全局 KV 结构 (Global KV System Config)**：
   - 存储默认的 LLM-as-a-Judge 裁判模型凭证（BaseURL、API Key、Model Name）及任务默认并发数、超时时间。
5. **单二进制交付架构 (Single-Binary Delivery)**：
   - 前端采用 React + Vite + TypeScript (pnpm 管理)，打包至 `web/dist`。
   - 后端使用 Go 1.16+ `//go:embed` 将前端静态资源内嵌，Gin 兼具 API 路由与静态资源托管，配合 SQLite3 做到真正的单二进制零外部依赖分发。

## 后续影响
- 评测计算口径严谨清晰，系统容错与排障直观。
- 环境变量灵活且对用户编写结构化或嵌套配置极度友好。
- 部署与运维成本极低。
