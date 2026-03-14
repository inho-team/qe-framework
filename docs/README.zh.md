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

```bash
claude plugin add github:inho-team/qe-framework
```

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

## Skills (51)

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

## 项目结构

```
qe-framework/
├── .claude-plugin/    # 插件配置
├── agents/            # 16 个代理 (E-prefix)
├── skills/            # 51 个技能 (Q-prefix)
├── core/              # 共享原则与配置
├── hooks/             # 生命周期钩子
├── install.js         # 安装脚本
└── package.json
```

## 许可证

UNLICENSED
