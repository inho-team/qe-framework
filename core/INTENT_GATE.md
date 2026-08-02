# IntentGate — User Intent Classification

## Overview
Rules for classifying user commands and routing them to the appropriate skill or agent.
All skills and agents refer to this classification to determine whether a request is appropriate for them.

## Intent Classification

| Intent | Keywords / Patterns | Routing Target |
|--------|---------------------|----------------|
| **Initialization** | "init", "initialize", "setup", "start" | Qplan (internal bootstrap) |
| **Planning** | "plan", "planning", "roadmap", "milestone", "phase", "계획", "로드맵" | Qplan |
| **Spec generation** | "spec", "task request", "verify checklist", "create task", "task spec", "명세" | Qplan (internal spec stage) |
| **Execution** | "run task", "execute task", "sequential", "ordered checklist", "실행" | Qplan (internal execution stage) |
| **Research** | "research", "compare", "which is better", "investigate" | Edeep-researcher |
| **Debugging** | "bug", "error", "not working", "why doesn't this work" | Ecode-debugger |
| **Review** | "review", "check", "look at this", "is this ok?" | Ecode-reviewer |
| **Testing** | "test", "coverage" | Ecode-test-engineer |
| **Documentation** | "docs", "explain", "README", "document" | Edoc-writer |
| **Commit** | "commit", "push", "save changes", "커밋", "푸시" | Qcommit |
| **Plugin update** | "update plugin", "upgrade", "update qe", "update codex", "codex plugin" | Qupdate |
| **Autonomous execution** | "utopia", "autonomous", "no questions", "auto execute" | Qplan |
| **Resume** | "continue", "resume", "restore" | Qresume |
| **Handoff** | "handoff", "save state", "save context", "end session", "컨텍스트 저장" | Qcompact |
| **PM documents** | "PRD", "product requirements", "user story", "meeting notes", "create presentation" | Qplan |
| **Refactor instructions** | "refactor CLAUDE.md", "split AGENTS.md", "organize instruction files", "instruction bloat" | Qplan |
| **Create skill** | "create a skill", "new skill", "modify skill", "skill performance", "benchmark skill" | Qplan |
| **Migrate tasks** | "migrate tasks", "reorganize tasks", "move task files", "update task structure" | Qplan |
| **Critical review** | "critical review", "adversarial review", "stress test", "risk proof" | Qcritical-review |
| **Domain knowledge** | "domain docs", "domain knowledge", "domain rules", "business rules docs" | Refer to .qe/docs/ for existing domain knowledge documents |
| **Agent team** | "create team", "spawn teammates", "parallel team", "team mode" | Refer to core/AGENT_TEAMS.md for team creation guidance |

Refactor, skill-creation, and migration specs must document a reviewed manual
procedure rather than assume an admin service. For skill work, use the repository
template and `npm run eval:skills` for the deterministic manifest; delegate behavioral
review to `Qcritical-review` when needed.

## Classification Rules

### 1. Explicit skill invocation takes priority
If the user explicitly invokes a public skill like `/Qplan`, skip IntentGate.
`Qgenerate-spec` and `Qexecute` are internal PSE stages and must not be exposed
as user-facing next commands.

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
- The quality loop is handled internally by Qplan → execution/verification stage → Eqa-orchestrator delegation

## Behavioral Contexts (core/contexts/)

Separate from the routing table above, `core/contexts/*.md` hold behavioral
guidelines that are injected as a digest when the matching intent is detected.
This is context injection, not routing: it does not pick a skill, it shapes how
the turn is carried out. Both can apply to one message.

The wiring lives in `hooks/scripts/prompt-check.mjs` (`CONTEXT_ROUTES`), which
injects each file's `## Principles` section on a keyword match. Keywords there
are deliberately narrower than this table — a context firing on an unrelated turn
costs tokens and dilutes the other hints.

| Context file | Intent |
|--------------|--------|
| `contexts/dev.md` | implement, build, create, add feature, refactor |
| `contexts/debug.md` | bug, error, not working, broken, crash |
| `contexts/review.md` | review this, code review, audit |
| `contexts/research.md` | research, compare, evaluate |
| `contexts/deploy.md` | deploy, release, ship |

A context file that no code loads is a silent no-op — the rules look enforced but
are not. `scripts/check-core-doc-wiring.mjs` guards against that regression.

## Using .qe/analysis/
Before routing, refer to `.qe/analysis/` to understand the project context.
This provides additional context for disambiguation when multiple intents could match.

## Using .qe/docs/
When domain-specific keywords appear, check `.qe/docs/` for existing domain knowledge documents.
- If relevant docs exist, include them in context before executing the routed skill/agent
- Domain knowledge in .qe/docs/ is referenced automatically — it is not directly invoked by user intent
