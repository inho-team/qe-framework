# QE Framework 文档导航

> 📖 **在浏览器中查看**: [入门 Intro →](https://inho-team.github.io/qe-framework/qe_framework_intro.zh.html) · [整体 Reference →](https://inho-team.github.io/qe-framework/qe_framework_diagram.zh.html)
>
> **其他语言**: [English](https://inho-team.github.io/qe-framework/qe_framework_intro.en.html) · [한국어](https://inho-team.github.io/qe-framework/qe_framework_intro.ko.html) · [日本語](https://inho-team.github.io/qe-framework/qe_framework_intro.ja.html)

QE Framework 是同时面向 Claude Code 和 Codex 的规范驱动任务执行框架。

基础流程:

```text
/Qplan -> /Qgs -> /Qatomic-run -> /Qcode-run-task
```

本文档是中文入口页。更详细的内容已经按主题拆分到独立文档中。

## 建议先读

- 项目概览: [../README.md](../README.md)
- 哲学与设计意图: [PHILOSOPHY.md](PHILOSOPHY.md)
- 详细使用方法: [USAGE_GUIDE.md](USAGE_GUIDE.md)
- 文档地图: [DOCUMENTATION_MAP.md](DOCUMENTATION_MAP.md)
- 多模型配置: [MULTI_MODEL_SETUP.md](MULTI_MODEL_SETUP.md)
- 系统总览: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)

## 核心概念

- `single-model`
  - 只使用 Claude 的默认路径
  - `/Qatomic-run` 使用 Haiku swarm 方式执行 atomic tasks
- `hybrid`
  - 只有部分角色使用外部 runner
- `multi-model`
  - planner / implementer / reviewer / supervisor 按角色显式分离
- `tiered-model`
  - 在同一 provider 内按任务难度分配高、中、低档模型

## 按订阅组合的推荐方式

| 可用工具 | 推荐模式 | 推荐默认映射 |
|----------|----------|--------------|
| 仅 Claude | `single-model` | Claude 负责全部角色 |
| Claude tiered | `tiered-model` | planner/supervisor = Opus，implementer/reviewer = Sonnet，低复杂度辅助 = Haiku |
| Codex tiered | `tiered-model` | planner/supervisor = GPT-5.4，implementer/reviewer = GPT-5-Codex，低复杂度辅助 = GPT-5-Codex-Mini |
| Claude + Codex | `hybrid` | implementer = Codex，其余 = Claude |
| Claude + Gemini | `hybrid` | reviewer = Gemini，其余 = Claude |
| Claude + Codex + Gemini | `multi-model` | planner/supervisor = Claude，implementer = Codex，reviewer = Gemini |

## 快速开始

1. 安装插件

```bash
claude plugin marketplace add inho-team/qe-framework
claude plugin install qe-framework@inho-team-qe-framework
```

安装是 **dual-target** 的——同时安装到 Claude 和 Codex。

- **Claude**：skill、agent、core、hooks、scripts 安装到 `~/.claude`。
- **Codex**（存在 `~/.codex` 时）：skill→`~/.codex/skills`，agent→`~/.codex/agents/*.toml`，
  并在 `~/.codex/config.toml` 写入 agent fence 与 `[[hooks.PreToolUse]]` 安全钩子 fence。
  非 Codex 用户（无 `~/.codex`）则静默跳过。安装后需在 Codex 中运行 `/hooks` 审批一次安全钩子。

**诚实的上限**：✅ 安装与安全防护（拦截 raw git commit、gh pr create、sed -i、直接写 plugin.json 版本）
与 Claude 完全一致。⚠️ 委派给 E-agent 的 skill 在 Codex 上**内联降级**（Codex 仅在显式 `/agent`
时才 spawn 子代理，无自动委派）。也可通过 `codex-plugin-cc`+`/Qsivs-config` 将 SIVS 阶段路由到 Codex **引擎**。

> `qe-framework-uninstall` 移除 Claude 资产；加 `--purge-codex` 时一并移除 Codex 资产
> （默认仅 dry-run 报告，绝不删除非 QE 内容）。

2. 初始化项目

```text
/Qinit
```

在 Codex 中可以这样按 skill 名称调用。

```text
$Qinit
```

3. 启动工作流

```text
/Qplan
/Qgs
/Qatomic-run
/Qcode-run-task
```

## 说明

- 如果 Codex 或 Gemini 因 quota 限制暂时不可用，可以使用 `--role-override` 做一次性重分配。
- 这个 override 只影响当前运行，不会修改 `team-config.json`。

## ⚠️ 自主执行模式 (`/Qutopia`)

`/Qutopia` 是一个会话开关，会**跳过所有确认提示**并自动推进。任务会加速完成，但也会带来提交错误文件、直接向 `main` push 等风险。

**启用前必须确认**:
1. 需求是否明确（存在原子化的 checklist）
2. 每一步是否都可回滚（无 force-push、迁移、破坏性删除）
3. working tree 是否干净（没有无关改动混入）
4. 不是共享分支（`main`/`master`）
5. 是否接受自动提交与自动迭代

完整指南及建议的开关使用模式请参阅 [USAGE_GUIDE.md §10](USAGE_GUIDE.md#10-autonomous-mode-qutopia--%EF%B8%8F-read-before-enabling)。**会话结束前务必执行 `/Qutopia off`**。
