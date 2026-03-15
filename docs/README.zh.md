[English](../README.md) | [한국어](README.ko.md) | **中文** | [日本語](README.ja.md)

# QE Framework (Query Executor)

Claude Code 的个人技能与代理插件包。

QE (Query Executor) 是一个将用户查询转化为结构化可执行任务的框架。它通过协调的技能和代理系统，处理从规格生成到实现、验证和提交的完整生命周期。

## 设计理念

QE Framework 基于经过验证的工程原则构建：

- **SOLID** -- 单一职责、开闭原则、里氏替换、接口隔离、依赖反转
- **DRY** -- 不重复逻辑；将公共逻辑提取为共享组件
- **KISS** -- 优先选择简单方案；消除不必要的复杂性
- **YAGNI** -- 只实现当前需要的功能；不做推测性设计
- **基于证据** -- 不做猜测。不确定时，读取文件并验证。
- **最小变更** -- 只修改被要求的部分。不重构相邻代码。
- **内部英语处理** -- 所有推理和分析在内部使用英语进行以获得更高的准确性，然后在回复前翻译为用户的语言。这在保持任何语言的自然对话的同时产生更好的结果。

## 架构

QE Framework 采用三层架构：

```
Skills (Q-prefix)          Agents (E-prefix)          Core
方法论与流程                执行与委派                 共享原则
/Qgenerate-spec            Etask-executor             PRINCIPLES.md
/Qsystematic-debugging     Ecode-debugger             INTENT_GATE.md
/Qcommit                   Ecommit-executor           AGENT_TIERS.md
```

- **Skills** 定义*如何*做某事（流程、方法论、工作流编排）
- **Agents** *执行*具体工作（编写代码、调试、审查、研究）
- **Core** 提供共享原则、意图路由和模型层级选择

## 安装

在**终端**中运行以下命令（不是在 Claude Code 会话内）：

### 步骤 1：注册 marketplace（仅首次需要）
```bash
claude plugin marketplace add inho-team/qe-framework
```

### 步骤 2：安装插件
```bash
claude plugin install qe-framework@inho-team-qe-framework
```

### 更新到最新版本
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

### 验证安装
```bash
claude plugin list
```

### 故障排除

**安装时出现 SSH permission denied 错误**

如果出现 `git@github.com: Permission denied (publickey)` 错误，运行以下命令强制使用 HTTPS：
```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```
然后重新执行安装命令。

> **注意**：插件命令必须在终端中运行，不能在 Claude Code 会话内运行。安装或更新后，请重启 Claude Code 以应用更改。

### 初始化项目

```
/Qinit
```

这将创建 `CLAUDE.md`、`.qe/` 目录结构，并运行初始项目分析。

## 使用方法

### 任务工作流

生成规格，然后执行：

```
/Qgenerate-spec    -- 创建 TASK_REQUEST.md + VERIFY_CHECKLIST.md
/Qrun-task         -- 执行任务并自动进行质量验证
```

### 提交变更

```
/Qcommit           -- 生成人类风格的提交，不留 AI 痕迹
```

### 调试

```
/Qsystematic-debugging   -- 在应用修复之前先进行根因分析
```

### 深度研究

调用 `Edeep-researcher` 代理进行技术比较、架构决策或调研任务。

### 其他示例

```
/Qgenerate-spec + /Qrun-task     -- 完整任务生命周期
/Qfrontend-design                -- 创建生产级 UI 组件
/Qtest-driven-development        -- 红-绿-重构 TDD 工作流
/Qgrad-paper-write               -- 学术论文撰写
/Qc4-architecture                -- C4 模型架构图
/Qrefresh                        -- 更新项目分析数据
```

## Skills (60 + 72 Coding Experts)

### 开发

| Skill | 描述 |
|-------|------|
| Qcommit | 创建看起来像人类编写的自然提交。移除 AI 痕迹。 |
| Qsystematic-debugging | 通过系统化调试先找到根因，测试假设，然后修复。 |
| Qtest-driven-development | TDD：先写测试，确认失败，用最少代码通过，重构。 |
| Qcode-run-task | 在代码任务完成后执行测试、审查、修复、重测的质量验证循环。 |
| Qfrontend-design | 创建原创的、生产级的高设计质量前端界面。 |
| Qspringboot-security | Java Spring Boot 服务的 Spring Security 最佳实践指南。 |
| Qdatabase-schema-designer | 设计健壮、可扩展的 SQL/NoSQL 数据库模式，包含规范化和索引策略。 |
| Qdoc-comment | 自动添加适合项目语言的文档注释。 |
| Qmcp-builder | 使用 Python (FastMCP) 或 TypeScript (MCP SDK) 创建 MCP (Model Context Protocol) 服务器的指南。 |
| Qagent-browser | 用于导航、表单填写、截图和数据提取的浏览器自动化 CLI。 |
| Qautoresearch | 受Karpathy autoresearch启发的自主实验循环。反复修改代码、评估指标、keep/discard判定。 |

### 任务管理

| Skill | 描述 |
|-------|------|
| Qgenerate-spec | 生成 CLAUDE.md、TASK_REQUEST.md 和 VERIFY_CHECKLIST.md 项目规格文档。 |
| Qrun-task | 基于 TASK_REQUEST 和 VERIFY_CHECKLIST 执行任务并自动验证。 |
| Qinit | QE 框架初始设置：创建 CLAUDE.md、配置、目录结构，并自动分析项目。 |
| Qrefresh | 手动刷新项目分析数据并显示变更历史。 |
| Qresume | 在压缩后恢复保存的上下文以继续之前的工作。 |
| Qcompact | 上下文保存与会话交接。保存上下文或生成交接文档。 |
| Qarchive | 自动归档已完成的任务文件。 |
| Qmigrate-tasks | 将分散的任务文件迁移到 .qe/tasks/ 和 .qe/checklists/ 目录结构中。 |
| Qupdate | 将 QE Framework 插件更新到最新版本。 |
| Qutopia | Utopia 模式 -- 无需任何确认的完全自主执行。 |

### 文档

| Skill | 描述 |
|-------|------|
| Qdocx | 创建、读取、编辑和操作 Word 文档 (.docx)。 |
| Qpdf | 所有 PDF 相关任务：读取、合并、拆分、水印、加密、OCR 等。 |
| Qpptx | 所有 PPTX 任务：创建幻灯片、读取、编辑和使用模板。 |
| Qxlsx | 所有电子表格任务 (.xlsx, .csv, .tsv)：公式、格式、图表和数据清理。 |
| Qwriting-clearly | 基于 Strunk 原则撰写更清晰、更有力的文章。 |
| Qhumanizer | 从文本中移除 AI 生成写作的痕迹。 |
| Qprofessional-communication | 技术沟通指南：邮件结构、团队消息、会议议程。 |
| Qmermaid-diagrams | 使用 Mermaid 语法生成软件图表（类图、时序图、流程图、ERD 等）。 |
| Qc4-architecture | 使用 C4 模型 Mermaid 图表生成架构文档。 |
| Qimage-analyzer | 分析图像：截图、图表、图形、线框图、OCR 文本提取。 |
| Qdoc-converter | MD、DOCX、PDF、PPTX、HTML之间的文档格式转换。支持多工具编排。 |
| Qcontent-research-writer | 包含引用、迭代改进和分节反馈的研究驱动内容写作。 |

### 学术

| Skill | 描述 |
|-------|------|
| Qgrad-paper-write | 按照标准章节结构系统地撰写学术论文。 |
| Qgrad-paper-review | 分析审稿人意见并撰写逐点回应的回复信。 |
| Qgrad-research-plan | 通过差距分析进行文献综述和实验设计。 |
| Qgrad-seminar-prep | 准备学术报告：幻灯片结构、脚本和预期问答。 |
| Qgrad-thesis-manage | 管理论文进度：章节结构、进度跟踪、导师会议准备。 |

### 规划

| Skill | 描述 |
|-------|------|
| Qpm-prd | 系统地编写 PRD，包含问题定义、用户画像和成功指标。 |
| Qpm-user-story | 使用 Mike Cohn 格式编写用户故事，附带 Gherkin 验收标准。 |
| Qpm-roadmap | 规划战略产品路线图，包含优先级排序和发布排期。 |
| Qrequirements-clarity | 在实现之前通过聚焦对话澄清模糊需求。 |
| Qqa-test-planner | 生成测试计划、手动测试用例、回归套件和缺陷报告。 |

### 媒体

| Skill | 描述 |
|-------|------|
| Qaudio-transcriber | 将音频录音 (MP3, WAV, M4A 等) 转换为专业的 Markdown 文档。 |
| Qyoutube-transcript-api | 提取、转录和翻译 YouTube 视频字幕/标题。 |
| Qtranslate | 多语言翻译，支持语法纠正。 |

### 元技能

| Skill | 描述 |
|-------|------|
| Qskill-creator | 创建新技能、修改现有技能并衡量技能性能。 |
| Qcommand-creator | 从重复工作流创建 Claude Code 斜杠命令。 |
| Qfind-skills | 在 skills.sh 上搜索技能并将其安装为 SKILL.md 文件。 |
| Qalias | 使用短名称为文件夹、路径和命令定义别名。 |
| Qprofile | 分析用户命令模式、写作风格和常用表达。 |
| Qagent-md-refactor | 按照渐进式披露原则重构臃肿的代理指令文件。 |
| Qweb-design-guidelines | 根据 Web Interface Guidelines 审查 UI 代码的可访问性和用户体验。 |
| Qlesson-learned | 通过 git 历史分析最近的代码变更并提取工程经验教训。 |
| Qhelp | 在终端中显示 QE Framework 快速参考卡。 |
| Qskill-tester | 自动技能路由测试器。验证意图分类准确性，发现误路由技能。 |
| Qjira-cli | 无需MCP服务器设置的轻量级Jira CLI包装器。用于快速工单管理。 |

### 分析

| Skill | 描述 |
|-------|------|
| Qdata-analysis | CSV/JSON/Excel 数据集的数据探索、统计分析和可视化。 |
| Qfinance-analyst | 财务分析、估值建模、DCF、蒙特卡洛模拟、投资组合优化。 |
| Qfact-checker | 从文档中提取事实主张，通过循证研究进行验证。 |
| Qsource-verifier | 使用SIFT方法验证来源可信度和数字内容真实性。 |

## Coding Expert Skills (72)

按领域分类的编码专家技能。每个技能提供其技术栈的深度专业知识，包括最佳实践、常见模式和生产级代码生成。

### Languages (14)

| Skill | 描述 |
|-------|------|
| Qcpp-pro | 使用 concepts、ranges、协程、SIMD 和模板元编程的现代 C++20/23。 |
| Qcsharp-developer | 使用 .NET 8+、ASP.NET Core、Blazor、Entity Framework 和 CQRS 模式的 C# 开发。 |
| Qembedded-systems | STM32、ESP32、FreeRTOS、裸机和实时系统固件开发。 |
| Qgolang | 具有严格测试驱动开发和质量门的 Go 开发标准。 |
| Qgolang-pro | 并发 Go 模式、gRPC/REST 微服务和性能优化。 |
| Qjava-architect | Spring Boot 3.x、WebFlux、JPA 优化和 OAuth2/JWT 安全。 |
| Qjavascript-pro | 现代 ES2023+、async/await、ESM 模块和 Node.js API。 |
| Qkotlin-specialist | 协程、Flow、KMP、Compose UI、Ktor 和类型安全 DSL。 |
| Qphp-pro | 使用 Laravel、Symfony、Swoole 异步和 PSR 标准的 PHP 8.3+。 |
| Qpython-pro | 具有类型安全、异步编程、pytest 和 mypy strict 模式的 Python 3.11+。 |
| Qrust-engineer | 所有权、生命周期、trait、tokio 异步和零成本抽象。 |
| Qsql-pro | 复杂查询、窗口函数、CTE、索引和跨方言迁移。 |
| Qswift-expert | 使用 SwiftUI、async/await、actor 和面向协议设计的 iOS/macOS 开发。 |
| Qtypescript-pro | 高级泛型、条件类型、品牌类型和 tRPC 集成。 |

### Frontend (12)

| Skill | 描述 |
|-------|------|
| Qangular-architect | Angular 17+ 独立组件、NgRx、RxJS 模式和懒加载。 |
| Qflutter-expert | 使用 Riverpod/Bloc、GoRouter 和平台特定实现的 Flutter 3+。 |
| Qgame-developer | Unity/Unreal Engine、ECS 架构、多人联网和着色器编程。 |
| Qnextjs-developer | Next.js 14+ App Router、Server Components、Server Actions 和流式 SSR。 |
| Qreact-best-practices | 来自 Vercel Engineering 的 React/Next.js 性能优化指南。 |
| Qreact-expert | 使用 hooks、Server Components、Suspense 和 React 19 特性的 React 18+。 |
| Qreact-native-expert | 使用 React Native、Expo 和原生模块集成的跨平台移动应用。 |
| Qvite | Vite 构建工具配置、插件 API、SSR 和 Rolldown 迁移。 |
| Qvue-best-practices | 使用 TypeScript、SSR 和 Volar 的 Vue 3 Composition API。 |
| Qvue-expert | Vue 3 Composition API、Nuxt 3、Pinia、Quasar/Capacitor 和 PWA 功能。 |
| Qvue-expert-js | 使用原生 JavaScript 和 JSDoc 类型标注的 Vue 3（无 TypeScript）。 |
| Qweb-design-guidelines-vercel | Web Interface Guidelines 合规性的 UI 代码审查。 |

### Backend (14)

| Skill | 描述 |
|-------|------|
| Qapi-designer | REST/GraphQL API 设计、OpenAPI 规范、版本控制和分页模式。 |
| Qarchitecture-designer | 系统架构、ADR、技术权衡和可扩展性规划。 |
| Qdjango-expert | Django REST Framework、ORM 优化和 JWT 认证。 |
| Qdotnet-core-expert | .NET 8 最小 API、整洁架构和云原生微服务。 |
| Qfastapi-expert | 使用 Pydantic V2 和 SQLAlchemy 的高性能异步 Python API。 |
| Qgraphql-architect | GraphQL 模式、Apollo Federation、DataLoader 和实时订阅。 |
| Qlaravel-specialist | 使用 Eloquent、Sanctum、Horizon、Livewire 和 Pest 测试的 Laravel 10+。 |
| Qlegacy-modernizer | Strangler fig 模式、branch by abstraction 和渐进式迁移。 |
| Qmcp-developer | 使用 TypeScript 或 Python SDK 的 MCP 服务器/客户端开发。 |
| Qmicroservices-architect | DDD、saga 模式、事件溯源、CQRS、服务网格和分布式追踪。 |
| Qnestjs-expert | NestJS 模块、依赖注入、守卫、拦截器和 Swagger 文档。 |
| Qrails-expert | 使用 Hotwire、Turbo Frames/Streams、Action Cable 和 Sidekiq 的 Rails 7+。 |
| Qspring-boot-engineer | Spring Boot 3.x REST、Spring Security 6、Spring Data JPA 和 WebFlux。 |
| Qwebsocket-engineer | 具有 Redis 扩展和在线状态追踪的实时 WebSocket/Socket.IO 系统。 |

### Data & AI (6)

| Skill | 描述 |
|-------|------|
| Qfine-tuning-expert | LoRA/QLoRA、PEFT、指令调优、RLHF、DPO 和模型量化。 |
| Qml-pipeline | MLflow、Kubeflow、Airflow、特征存储和实验追踪。 |
| Qpandas-pro | DataFrame 操作、聚合、合并、时间序列和性能优化。 |
| Qprompt-engineer | 提示词设计、思维链、少样本学习和评估框架。 |
| Qrag-architect | RAG 系统、向量数据库、混合搜索、重排序和嵌入管道。 |
| Qspark-engineer | Spark DataFrame 转换、SQL 优化和结构化流处理。 |

### Infra & DevOps (14)

| Skill | 描述 |
|-------|------|
| Qatlassian-mcp | 通过 MCP 集成 Jira/Confluence，用于问题追踪和文档管理。 |
| Qchaos-engineer | 混沌实验、故障注入、演练日和弹性测试。 |
| Qcli-developer | 具有参数解析、自动补全和交互式提示的 CLI 工具。 |
| Qcloud-architect | 多云架构、Well-Architected Framework 和成本优化。 |
| Qdatabase-optimizer | 查询优化、EXPLAIN 分析、索引设计和分区策略。 |
| Qdevops-engineer | Docker、CI/CD、Kubernetes、Terraform、GitHub Actions 和 GitOps。 |
| Qkubernetes-specialist | K8s 清单、Helm chart、RBAC、NetworkPolicies 和多集群管理。 |
| Qmonitoring-expert | Prometheus/Grafana、结构化日志、告警、分布式追踪和负载测试。 |
| Qpostgres-pro | PostgreSQL EXPLAIN、JSONB、扩展、VACUUM 调优和复制。 |
| Qsalesforce-developer | Apex、Lightning Web Components、SOQL、触发器和平台事件。 |
| Qshopify-expert | Liquid 主题、Hydrogen 店面、Shopify 应用和结账扩展。 |
| Qsre-engineer | SLI/SLO、错误预算、事件响应、混沌工程和容量规划。 |
| Qterraform-engineer | Terraform 模块、状态管理、多环境工作流和测试。 |
| Qwordpress-pro | WordPress 主题、Gutenberg 区块、WooCommerce、REST API 和安全加固。 |

### Quality & Security (12)

| Skill | 描述 |
|-------|------|
| Qcode-documenter | 文档字符串、OpenAPI/Swagger 规范、JSDoc 和文档门户。 |
| Qcode-reviewer | 代码质量审计：缺陷、安全、性能、命名和架构。 |
| Qdebugging-wizard | 错误解析、堆栈追踪分析和假设驱动的根因隔离。 |
| Qfeature-forge | 需求研讨会、用户故事、EARS 格式规范和验收标准。 |
| Qfullstack-guardian | 具有分层认证和验证的安全导向全栈开发。 |
| Qplaywright-expert | 使用 Playwright 的 E2E 测试、页面对象、fixture 和视觉回归。 |
| Qsecure-code-guardian | 认证、输入验证、OWASP Top 10 防护和加密。 |
| Qsecurity-reviewer | 安全审计、SAST、渗透测试和合规检查。 |
| Qspec-miner | 从遗留/无文档代码库逆向工程提取规范。 |
| Qtest-master | 测试策略、覆盖率分析、性能测试和测试架构。 |
| Qthe-fool | 魔鬼代言人、预验尸、红队演练和假设审计。 |
| Qvitest | 具有 Jest 兼容 API、mock 和覆盖率的 Vitest 单元测试。 |

## 后台处理

QE Framework 在关键生命周期节点静默运行多个代理。这些代理无需手动调用 -- 它们由钩子和其他代理自动触发。

### 工作原理

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        QE Framework Lifecycle                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Session Start                                                        │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ SessionStart │───▶│ Erefresh-executor   │  Update .qe/analysis/    │
│  │    Hook      │    │ (if analysis stale) │  before any work begins  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  User Interaction                                                     │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreToolUse   │───▶│   Intent Gate       │  Route user intent to    │
│  │    Hook      │    │   Classification    │  the correct skill/agent │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PostToolUse  │───▶│ Eprofile-collector  │  Learn user patterns     │
│  │    Hook      │    │ (command, style)    │  and correction history  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Context Pressure (75%+)                                              │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreCompact   │───▶│ Ecompact-executor   │  Save snapshot before    │
│  │    Hook      │    │ (auto-save context) │  context is lost         │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Task Completion                                                      │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │  Qrun-task   │───▶│ Earchive-executor   │  Archive completed tasks │
│  │  completes   │    │ Ecommit-executor    │  Auto-commit changes     │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ Notification │───▶│  Chain follow-up    │  Trigger next actions    │
│  │    Hook      │    │  actions            │  when agents complete    │
│  └──────────────┘    └─────────────────────┘                          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 生命周期钩子

框架使用 6 个在特定事件触发的生命周期钩子：

| Hook | 触发时机 | 执行内容 |
|------|----------|----------|
| `SessionStart` | 会话开始时 | 注入框架规则，如果分析数据过时则触发 `Erefresh-executor` |
| `PreToolUse` | 每次工具调用前 | **Intent Gate** -- 分类用户意图并路由到正确的 skill/agent |
| `PostToolUse` | 每次工具调用后 | 触发 `Eprofile-collector` 记录用户模式 |
| `PreCompact` | 上下文压缩前 | 触发 `Ecompact-executor` 在上下文丢失前保存 |
| `Stop` | 会话结束时 | 清理和收尾 |
| `Notification` | 后台代理完成时 | 在后台代理完成后链式触发后续操作 |

### 后台代理

这些代理自动运行，无需用户交互。它们将结果写入 `.qe/` 文件，从不直接回复用户。

#### Erefresh-executor -- 项目分析同步

> 保持 `.qe/analysis/` 最新，使其他代理可以跳过昂贵的项目扫描。

| | 详情 |
|---|---|
| **触发时机** | 会话开始时（如果过时）、Qrun-task 之前，或通过 `/Qrefresh` 手动触发 |
| **写入位置** | `.qe/analysis/*.md`, `.qe/changelog.md` |
| **Token 节省** | 约 50% -- 代理读取 4 个分析文件而非扫描数十个文件 |

**步骤：**
1. 通过 `git diff` 和文件系统扫描检测变更
2. 更新 4 个分析文件：`project-structure`、`tech-stack`、`entry-points`、`architecture`
3. 在 `.qe/changelog.md` 中记录变更历史，标记为 `[External Change]` 或 `[QE]`

#### Ecompact-executor -- 上下文保存

> 在上下文压缩前保存轻量快照，以便会话可以恢复。

| | 详情 |
|---|---|
| **触发时机** | 上下文窗口达到 75%+ 容量（黄色区域），或通过 `/Qcompact` 手动触发 |
| **写入位置** | `.qe/context/snapshot.md`, `.qe/context/decisions.md` |
| **Token 节省** | 约 70% -- 从少量文件恢复上下文而非重新探索项目 |

**步骤：**
1. 收集进行中的任务、检查清单状态、最近的文件变更和关键决策
2. 将快照保存到 `.qe/context/snapshot.md`（仅路径和摘要，不含代码）
3. 以倒序时间顺序在 `.qe/context/decisions.md` 中积累决策

#### Earchive-executor -- 任务归档

> 将已完成的任务移动到版本化存档中，保持工作区整洁。

| | 详情 |
|---|---|
| **触发时机** | Qrun-task 标记任务为已完成时，或通过 `/Qarchive` 手动触发 |
| **写入位置** | `.qe/.archive/vX.Y.Z/tasks/`, `.qe/.archive/vX.Y.Z/checklists/` |

**步骤：**
1. 扫描 `.qe/tasks/pending/` 中完全完成的任务
2. 将已完成的 TASK_REQUEST 和 VERIFY_CHECKLIST 移动到 `.qe/.archive/vX.Y.Z/`
3. 在归档文件旁保存 CLAUDE.md 快照

#### Ecommit-executor -- 自动提交

> 创建人类风格的提交，零 AI 痕迹。

| | 详情 |
|---|---|
| **触发时机** | 由 `/Qcommit` 委派，或在 Qrun-task 完成后自动提交 |
| **禁止内容** | `Co-Authored-By` 行、AI 相关措辞、表情符号 |

**步骤：**
1. 分析 `git diff` 并匹配项目现有的提交消息风格
2. 选择性地暂存相关文件（排除 `.env`、凭据文件）
3. 创建与人类编写无法区分的提交

#### Eprofile-collector -- 用户模式学习

> 随时间学习用户偏好，提高意图识别准确性。

| | 详情 |
|---|---|
| **触发时机** | 任何 skill 或 agent 完成后 |
| **写入位置** | `.qe/profile/command-patterns.md`, `writing-style.md`, `corrections.md`, `preferences.md` |

**收集内容：**

| 文件 | 内容 |
|------|------|
| `command-patterns.md` | Skill/agent 调用频率和最近使用时间 |
| `writing-style.md` | 正式/非正式模式、缩写词典 |
| `corrections.md` | 用户纠正历史，防止重复误解 |
| `preferences.md` | 回复长度、代码风格、语言偏好 |

#### Ehandoff-executor -- 会话交接

> 生成经过验证的交接文档，实现无缝跨会话延续。

| | 详情 |
|---|---|
| **触发时机** | 通过 `/Qcompact`（交接模式）手动触发 |
| **写入位置** | `.qe/handoffs/HANDOFF_{date}_{time}.md` |

**步骤：**
1. 收集任务状态、检查清单进度、最近的 git 变更和决策
2. 生成包含具体后续步骤的结构化交接文档
3. 验证所有引用的文件和任务 UUID 确实存在

#### Edoc-generator -- 批量文档生成

> 从主上下文窗口卸载繁重的文档生成工作。

| | 详情 |
|---|---|
| **触发时机** | 由 Epm-planner、Qrun-task (`type: docs`) 或多文档请求委派 |
| **支持格式** | `.docx`, `.pdf`, `.pptx`, `.xlsx` |

可用时使用模板，并行处理多个文档。

---

## Agents (16)

代理根据任务复杂度自动分配模型层级。详见 [AGENT_TIERS.md](../core/AGENT_TIERS.md)。

### HIGH 层级 (opus)

| Agent | 描述 |
|-------|------|
| Edeep-researcher | 用于技术比较和决策支持的系统化多步骤研究代理。 |
| Eqa-orchestrator | 执行完整的测试、审查、修复质量循环。保护主上下文。 |

### MEDIUM 层级 (sonnet)

| Agent | 描述 |
|-------|------|
| Etask-executor | 按顺序实现检查清单项目。学习任务模式以应对重复工作。 |
| Ecode-debugger | 调试专家。分析缺陷根因、追踪错误并排除故障。 |
| Ecode-reviewer | 代码审查专家。审查质量、安全性、性能和模式合规性。 |
| Ecode-test-engineer | 测试工程师。处理测试编写、覆盖率分析和测试策略。 |
| Ecode-doc-writer | 技术文档专家。编写代码说明、API 文档和 README。 |
| Edoc-generator | 用于批量文档生成的后台子代理 (docx/pdf/pptx/xlsx)。 |
| Egrad-writer | 以学术写作风格和引用规范撰写学术论文章节。 |
| Epm-planner | 规划专家。处理 PRD、用户故事、路线图和文档生成。 |
| Erefresh-executor | 检测项目变更，更新 .qe/ 分析数据，并记录变更历史。 |
| Ecompact-executor | 检测上下文窗口压力，保存上下文，并支持压缩后恢复。 |
| Ehandoff-executor | 生成和验证会话交接文档。 |

### LOW 层级 (haiku)

| Agent | 描述 |
|-------|------|
| Earchive-executor | 按版本将已完成的任务文件归档到 .qe/.archive/ 中。 |
| Ecommit-executor | 分析差异，生成提交消息，并暂存文件，不留 AI 痕迹。 |
| Eprofile-collector | 收集用户命令模式、写作风格和纠正历史。 |

## Agent Teams（实验性）

QE Framework 支持 [Claude Agent Teams](https://code.claude.com/docs/en/agent-teams)，用于需要并行协作的复杂任务。Agent Teams 生成多个 Claude 实例，直接通信并共享任务列表。

### Teams 触发条件

当功能启用且任务达到复杂度阈值时，Teams 会自动激活：

| Agent | Team 触发条件 | Team 结构 |
|-------|-------------|-----------|
| Eqa-orchestrator | 3 个以上测试/源码组 | Test Engineer + Code Reviewer 并行 |
| Etask-executor | 5 个以上独立检查清单项 | 每个文件组一名队友 |
| Edeep-researcher | 3 个以上研究来源/视角 | Researchers + Devil's Advocate |

### 启用 Agent Teams

在 `.claude/settings.json` 中添加：
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

当 Agent Teams 未启用时，所有代理回退到现有的 Subagent 行为。

详细配置和团队模式请参阅 [AGENT_TEAMS.md](../core/AGENT_TEAMS.md)。

## 项目结构

```
qe-framework/
├── .claude-plugin/    # 插件配置
├── agents/            # 16 个代理 (E-prefix)
├── skills/            # 60 个核心 + 72 个编码专家技能 (Q-prefix)
├── core/              # 共享原则与配置
├── hooks/             # 生命周期钩子
├── install.js         # 安装脚本
└── package.json
```

## 许可证

UNLICENSED
