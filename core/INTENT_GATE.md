# IntentGate — User Intent Classification

## Overview
Rules for classifying user commands and routing them to the appropriate skill or agent.
All skills and agents refer to this classification to determine whether a request is appropriate for them.

## Intent Classification

| Intent | Keywords / Patterns | Routing Target |
|--------|---------------------|----------------|
| **Initialization** | "init", "initialize", "setup", "start" | Qinit |
| **Planning** | "plan", "planning", "roadmap", "milestone", "phase", "계획", "로드맵" | Qplan |
| **Spec generation** | "spec", "task request", "verify checklist", "create task", "task spec", "명세" | Qgenerate-spec |
| **Execution** | "run task", "execute task", "sequential", "ordered checklist", "실행" | Qrun-task |
| **Research** | "research", "compare", "which is better", "investigate" | Edeep-researcher |
| **Debugging** | "bug", "error", "not working", "why doesn't this work" | Ecode-debugger |
| **Review** | "review", "check", "look at this", "is this ok?" | Ecode-reviewer |
| **Testing** | "test", "coverage" | Ecode-test-engineer |
| **Documentation** | "docs", "explain", "README", "document" | Ecode-doc-writer |
| **Commit** | "commit", "push", "save changes", "커밋", "푸시" | Qcommit |
| **Refresh** | "refresh analysis", "sync analysis", ".qe/analysis", "analysis snapshot", "분석 데이터 갱신" | Qrefresh |
| **Plugin update** | "update plugin", "upgrade", "update qe", "update codex", "codex plugin" | Qupdate |
| **Utopia mode** | "utopia", "autonomous", "no questions", "auto execute" | Qutopia |
| **Help** | "help", "how to use", "show commands", "command catalog", "도움말" | Qhelp |
| **Resume** | "continue", "resume", "restore" | Qresume |
| **Handoff** | "handoff", "save state", "save context", "end session", "컨텍스트 저장" | Qcompact |
| **PM documents** | "PRD", "product requirements", "user story", "meeting notes", "create presentation" | Epm-planner |
| **MCP server** | "MCP server", "Model Context Protocol", "FastMCP", "MCP SDK", "MCP integration" | Qmcp |
| **QA test plan** | "test plan", "test cases", "regression suite", "QA testing", "bug report template" | Qqa |
| **Humanize text** | "humanize", "remove AI writing", "make it sound natural", "AI trace" | Qwriting-clearly |
| **Refactor instructions** | "refactor CLAUDE.md", "split AGENTS.md", "organize instruction files", "instruction bloat" | Refer to qe-admin-mcp maintainer workflows |
| **Find skills** | "find a skill", "search skills.sh", "install skill", "skill marketplace" | Qhelp |
| **Create skill** | "create a skill", "new skill", "modify skill", "skill performance", "benchmark skill" | Refer to qe-admin-mcp maintainer workflows |
| **Migrate tasks** | "migrate tasks", "reorganize tasks", "move task files", "update task structure" | Refer to qe-admin-mcp maintainer workflows |
| **Writing quality** | "write clearly", "improve prose", "writing quality", "Strunk", "concise writing" | Qwriting-clearly |
| **Domain knowledge** | "domain docs", "domain knowledge", "domain rules", "business rules docs" | Refer to .qe/docs/ for existing domain knowledge documents |
| **Agent team** | "create team", "spawn teammates", "parallel team", "team mode" | Refer to core/AGENT_TEAMS.md for team creation guidance |

## Classification Rules

### 1. Explicit skill invocation takes priority
If the user explicitly invokes a skill like `/Qgenerate-spec`, skip IntentGate.

### 2. Keyword matching
When there is no explicit invocation, detect keywords in the user's message.
- Multiple intents overlap → ask the user for clarification
- Exactly one match → execute the corresponding skill or agent

### 3. Ambiguous cases
When intent cannot be determined, ask the user:
- "What would you like to do? (Generate spec / Run code / Research / Other)"

### 5. Skill vs Agent disambiguation
When the same domain has both a skill and an agent:
- "fix this bug" / "debug this error" / "not working" → Ecode-debugger (execution)
- "write tests" / "test coverage" / "add unit tests" → Ecode-test-engineer (execution)
- Quality loop is handled internally by Qcode-run-task → Eqa-orchestrator delegation

## Using .qe/analysis/
Before routing, refer to `.qe/analysis/` to understand the project context.
This provides additional context for disambiguation when multiple intents could match.

## Using .qe/docs/
When domain-specific keywords appear, check `.qe/docs/` for existing domain knowledge documents.
- If relevant docs exist, include them in context before executing the routed skill/agent
- Domain knowledge in .qe/docs/ is referenced automatically — it is not directly invoked by user intent
