# Agent Evaluation (Agent 黑盒评测系统)

基于 Golang (Gin + Goja + SQLite3) 与 React 构建的轻量级、开箱即用的端到端 Agent 黑盒评测平台。支持灵活的环境变量定义、Goja JS 场景脚本适配、测试用例集管理、多类型评测器组合评估（规则、LLM 裁判、自定义 JS 脚本）及质检双轨人工复核。

---

## 核心特性

- **黑盒端到端评测**：聚焦输入输出及调用链路的端到端质量，不侵入 Agent 内部逻辑。
- **动态场景脚本 (Goja JS 沙箱)**：通过 JavaScript 沙箱隔离执行 `execute(env, input)` 逻辑，支持 HTTP 代理请求、耗时统计与日志拦截。
- **环境与用例集解耦**：环境变量（包含密钥脱敏）、动态列结构数据集导入导出（JSON/CSV）、用例批量录入。
- **多维度评测器组合**：
  - **规则评测器 (Rule)**：正则匹配、关键词包含/排除、JSON Schema 校验、一票否决规则。
  - **LLM 裁判评测器 (LLM-as-a-Judge)**：结构化评分与扣分归因理由输出。
  - **脚本评测器 (Script)**：自定义 JS 评分逻辑。
- **双轨人工复核与质检**：支持人机协同复核，覆盖差错归因、申诉重评与标注对比。
- **单二进制交付**：前端静态资源通过 Go `embed` 内嵌，单一二进制即可独立运行，无需外部 Node.js 运行时或重型数据库。
- **Agent 自优化集成**：内置 `skills/agent-eval`，为编码智能体（Claude Code、Cursor、Windsurf 等）提供一键评测、进度轮询与 Bad Case 诊断报告集成。

---

## 技术架构

```
┌────────────────────────────────────────────────────────┐
│                   React Web UI (Vite)                  │
└───────────────────────────┬────────────────────────────┘
                            │ RESTful API
┌───────────────────────────▼────────────────────────────┐
│                    Gin HTTP Server                     │
├───────────────────────────┬────────────────────────────┤
│    Task Runner / Pool     │   Evaluators (Rule/LLM/JS) │
├───────────────────────────┴────────────────────────────┤
│           Goja JS Sandbox (Scenario Execution)         │
├────────────────────────────────────────────────────────┤
│           GORM + SQLite3 (WAL Mode, Pure Go)           │
└────────────────────────────────────────────────────────┘
```

- **后端**：Go 1.22+、Gin Web Framework、Goja (ECMAScript 5.1(+) 纯 Go 解释器)、GORM、`modernc.org/sqlite` (无 CGO 依赖，纯 Go 编译)。
- **前端**：React 18、TypeScript、Vite、Tailwind CSS、Lucide Icons。
- **构建管理**：后端使用标准 Go 工具链，前端使用 pnpm 管理依赖。

---

## 快速上手

### 1. 本地开发调试

#### 后端启动 (监听 `:8080`)
```bash
# 下载依赖并运行
go mod tidy
go run cmd/server/main.go
```

#### 前端开发服务 (监听 `:5173`，自动代理 API 到 `:8080`)
```bash
cd web
pnpm install
pnpm dev
```

### 2. 单二进制打包部署 (Production Single Binary)

单二进制可执行文件内置打包后的前端资源，一键运行即可使用完整功能：

```bash
# 1. 编译前端静态资源
cd web && pnpm install && pnpm build && cd ..

# 2. 编译生产二进制 (内嵌 web/dist)
go build -ldflags="-s -w" -o agent-eval-server cmd/server/main.go

# 3. 运行服务 (默认监听 8080 端口，数据文件生成在 data/eval.db)
./agent-eval-server
```

启动后可在浏览器中访问：`http://localhost:8080`。首次启动将在控制台输出预置管理员账号与密码。

---

## 目录结构

```
.
├── cmd/server/           # 后端服务主入口
├── internal/
│   ├── api/              # RESTful API 控制器与路由
│   ├── db/               # 数据库初始化、SQLite 自动迁移与种子数据
│   ├── engine/           # 任务调度执行池与 Goja JS 沙箱环境
│   ├── evaluator/        # 评测器实现 (规则、LLM 裁判、JS 脚本)
│   └── model/            # 实体模型与数据库定义
├── docs/                 # 系统架构方案与 ADR 文档
│   ├── DESIGN.md         # 详细技术方案设计
│   └── adr/              # 架构决策记录
├── skills/agent-eval/    # 编码 Agent 自动化评测自优化 Skill
├── web/                  # 前端 React 工程 (Vite + TypeScript + Tailwind)
├── AGENTS.md             # 智能体开发与协作指南
├── GLOSSARY.md           # 领域统一术语定义
└── go.mod / go.sum       # Go 依赖配置
```

---

## 更多文档

- [系统架构与详细设计方案 (DESIGN.md)](docs/DESIGN.md)
- [领域统一术语表 (GLOSSARY.md)](GLOSSARY.md)
- [智能体开发指导规则 (AGENTS.md)](AGENTS.md)
- [0001: 核心架构与运行模型](docs/adr/0001-agent-evaluation-architecture.md)
- [0002: 评测流水线调度、数据契约与交付形态](docs/adr/0002-evaluation-pipeline-and-data-contracts.md)

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
