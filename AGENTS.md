# Agent 评测系统开发指南 (AGENTS.md)

## 1. 项目目标
基于 Golang (Gin + Goja + SQLite3) 与 React 前端构建轻量级、开箱即用的端到端 Agent 黑盒评测平台，支持灵活的环境变量定义、Goja JS 场景脚本适配、测试用例集管理、多类型评测器组合评估（规则、LLM裁判、自定义JS脚本）及质检双轨人工复核。

## 2. 整体架构与规范参考
- 详细系统设计方案：[docs/DESIGN.md](file:///home/wmx/workspace/repository/agent-evaluation/docs/DESIGN.md)
- 领域统一术语表：[GLOSSARY.md](file:///home/wmx/workspace/repository/agent-evaluation/GLOSSARY.md)
- 架构决策记录：
  - [0001: 核心架构与运行模型](file:///home/wmx/workspace/repository/agent-evaluation/docs/adr/0001-agent-evaluation-architecture.md)
  - [0002: 评测流水线调度、数据契约与交付形态](file:///home/wmx/workspace/repository/agent-evaluation/docs/adr/0002-evaluation-pipeline-and-data-contracts.md)

## 3. 主要模块职责
- `cmd/server/`：程序主入口，配置初始化、SQLite 数据库连接池（开启 WAL）、Gin 路由绑定以及静态文件内嵌托管。
- `internal/api/`：RESTful API 控制器，提供环境、场景、用例集、评测模块、评测任务、运行记录、人工复核与系统配置接口。
- `internal/engine/`：任务执行调度与沙箱模块。基于 Goroutine Worker Pool 控制并发，使用 Goja 虚拟机沙箱执行 `execute(env, input)` 场景脚本，并注入 HTTP 请求代理与日志截获。
- `internal/evaluator/`：评测模块实现库，包含 Rule Evaluator、LLM-as-a-Judge 与 Goja Script Evaluator，负责得分计算与一票否决判定。
- `internal/model/`：SQLite 实体定义与数据库迁移。
- `web/`：前端 React 工程（基于 Vite + TypeScript + Tailwind CSS / UI 组件库），采用 pnpm 管理依赖。

## 4. 开发与构建命令

### 后端开发 (Golang)
```bash
# 下载 Go 依赖
go mod tidy

# 本地启动后端服务 (监听 :8080)
go run cmd/server/main.go
```

### 前端开发 (React)
```bash
cd web

# 依赖安装
pnpm install

# 本地启动开发服务器 (监听 :5173，通过 Vite Proxy 转发 /api 至 :8080)
pnpm dev

# 生产环境静态打包 (输出至 web/dist)
pnpm build
```

### 单二进制整合打包 (Production Single Binary)
```bash
# 1. 构建前端静态资源
cd web && pnpm build && cd ..

# 2. 编译 Go 单二进制可执行文件 (内嵌 web/dist)
go build -ldflags="-s -w" -o agent-eval-server cmd/server/main.go

# 3. 运行服务
./agent-eval-server
```
