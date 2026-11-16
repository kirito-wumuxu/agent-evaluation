# Agent Evaluation System

Agent 评测系统用于对各类 AI Agent 在不同环境下的端到端输出质量进行黑盒自动化评估与人工复核。

## Language

**Environment**:
目标运行环境配置，包含被测 Agent 服务的基础地址（BaseURL）、认证凭证（API Key / Token）及自定义环境变量字典。
_Avoid_: 环境、运行环境配置、HostConfig

**Scenario**:
评测场景定义，包含使用 Goja (JavaScript) 编写的调度脚本，负责读取 Environment 变量、组装 Case 的输入数据并调用被测 Agent 接口获取实际输出。
_Avoid_: 脚本配置、调用模版、测试场景

**Dataset**:
评测用例的集合，用于跨场景与环境复用的数据载体。
_Avoid_: 用例库、数据源、Test Suite

**TestCase**:
单条评测样本，包含被测输入（Input）、期望输出（Expected Output / Ground Truth）及可选的元数据（Metadata）。
_Avoid_: 样本、测试用例、评测数据项

**Evaluator**:
用于对 Agent 实际输出与期望输出进行打分或合规性校验的评测模块（如规则匹配、LLM-as-a-Judge、自定义 JS 脚本）。
_Avoid_: 评估指标、评估器、评分插件

**EvaluationTask**:
一次评测配置定义或评测计划，将 Environment、Scenario、Dataset 与 Evaluator 组合为一个可执行单元。
_Avoid_: 任务模板、评测方案、Benchmark

**RunRecord**:
一次 EvaluationTask 的实际执行实例，记录总用时、各用例的输入、Agent实际输出、评估得分、状态及聚合统计指标。
_Avoid_: 执行历史、运行日志、评测记录

**RunRecordItem**:
RunRecord 中针对单个 TestCase 的详细执行记录，包含实际请求与返回、机器各 Evaluator 打分明细、人工复核双轨修正结果与错误日志。
_Avoid_: 测试明细、单条记录、Case结果

**HumanReview**:
人工复核流程，支持质检人员对 RunRecord 中各用例的机器评估得分与判定进行修正、填写复核意见并更新最终复核得分。
_Avoid_: 人工打分、人工审核、人工标注

**SystemConfig**:
评测系统的全局配置，维护全局默认裁判模型凭证、默认并发数与超时时间等基础参数。
_Avoid_: 全局变量、系统设置、环境变量

