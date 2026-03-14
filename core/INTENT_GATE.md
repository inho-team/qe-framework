# IntentGate — User Intent Classification

## Overview
Rules for classifying user commands and routing them to the appropriate skill or agent.
All skills and agents refer to this classification to determine whether a request is appropriate for them.

## Intent Classification

| Intent | Keywords / Patterns | Routing Target |
|--------|---------------------|----------------|
| **Initialization** | "init", "initialize", "setup", "start" | Qinit |
| **Spec generation** | "spec", "plan", "create task", "task" | Qgenerate-spec |
| **Execution** | "run", "execute", "go", "start" | Qrun-task |
| **Research** | "research", "compare", "which is better", "investigate" | Edeep-researcher |
| **Debugging** | "bug", "error", "not working", "why doesn't this work" | Ecode-debugger |
| **Review** | "review", "check", "look at this", "is this ok?" | Ecode-reviewer |
| **Testing** | "test", "coverage" | Ecode-test-engineer |
| **Documentation** | "docs", "explain", "README", "document" | Ecode-doc-writer |
| **Commit** | "commit", "save", "push", "푸시", "커밋" | Qcommit |
| **Refresh** | "refresh", "sync", "latest" | Qrefresh |
| **Plugin update** | "update plugin", "upgrade", "update qe", "최신 버전", "플러그인 업데이트" | Qupdate |
| **Utopia mode** | "utopia", "autonomous", "no questions", "자동 실행", "물어보지 마" | Qutopia |
| **Resume** | "continue", "resume", "restore" | Qresume |
| **Handoff** | "handoff", "save state", "end session" | Qcompact (manual mode) |
| **Planning** | "PRD", "product plan", "user story", "roadmap" | Epm-planner |
| **Academic** | "paper", "seminar", "thesis", "review response" | Qgrad-* (matching skill) |
| **PDF/Doc generation** | "PDF", "Word", "PPT", "Excel" | Qdocx/Qpdf/Qpptx/Qxlsx |
| **Browser automation** | "browser", "navigate", "screenshot", "form fill", "scrape", "web test" | Qagent-browser |
| **Frontend design** | "design UI", "create component", "React component", "dashboard", "styling", "web component" | Qfrontend-design |
| **Spring Security** | "Spring Security", "authentication", "authorization", "CSRF", "JWT", "security headers" | Qspringboot-security |
| **Architecture diagram** | "architecture diagram", "C4 diagram", "system context", "container diagram", "deployment diagram" | Qc4-architecture |
| **Database design** | "schema design", "database design", "create tables", "data modeling", "normalization", "indexing" | Qdatabase-schema-designer |
| **MCP server** | "MCP server", "Model Context Protocol", "FastMCP", "MCP SDK", "MCP integration" | Qmcp-builder |
| **Systematic debugging** | "root cause", "debug systematically", "test hypothesis", "trace error", "find bug cause" | Qsystematic-debugging |
| **TDD** | "TDD", "test-driven", "write test first", "red-green-refactor", "before implementing" | Qtest-driven-development |
| **QA test plan** | "test plan", "test cases", "regression suite", "QA testing", "bug report template" | Qqa-test-planner |
| **Doc comments** | "add docstring", "documentation comments", "JSDoc", "JavaDoc", "KDoc", "TSDoc" | Qdoc-comment |
| **Requirements clarity** | "clarify requirements", "unclear feature", "ambiguous specs", "YAGNI check" | Qrequirements-clarity |
| **Humanize text** | "humanize", "remove AI writing", "make it sound natural", "AI trace" | Qhumanizer |
| **Professional communication** | "professional email", "team message", "meeting agenda", "communication guide" | Qprofessional-communication |
| **YouTube transcript** | "YouTube subtitles", "video captions", "transcribe video", "extract subtitles" | Qyoutube-transcript-api |
| **Lesson learned** | "what can we learn", "key takeaway", "look back at this code", "code review insight" | Qlesson-learned |
| **Refactor instructions** | "refactor CLAUDE.md", "split AGENTS.md", "organize instructions", "instruction bloat" | Qagent-md-refactor |
| **Find skills** | "find a skill", "search skills.sh", "install skill", "skill marketplace" | Qfind-skills |
| **Create skill** | "create a skill", "new skill", "modify skill", "skill performance", "benchmark skill" | Qskill-creator |
| **Create command** | "create slash command", "make a command", "reusable workflow", "automate process" | Qcommand-creator |
| **Alias management** | "create alias", "register shortcut", "path alias", "command alias" | Qalias |
| **User profile** | "analyze my patterns", "user profile", "command patterns", "my style" | Qprofile |
| **Migrate tasks** | "migrate tasks", "reorganize tasks", "move task files", "update task structure" | Qmigrate-tasks |
| **Audio transcription** | "transcribe audio", "meeting recording", "audio to text", "convert recording" | Qaudio-transcriber |
| **Image analysis** | "analyze image", "describe screenshot", "extract text from image", "analyze wireframe" | Qimage-analyzer |
| **Mermaid diagrams** | "mermaid diagram", "sequence diagram", "flowchart", "ERD", "class diagram", "Gantt chart" | Qmermaid-diagrams |
| **Translation** | "translate", "grammar correction", "multilingual", "convert to English" | Qtranslate |
| **Web design review** | "UI review", "accessibility check", "design audit", "UX review", "web guidelines" | Qweb-design-guidelines |
| **Writing quality** | "write clearly", "improve prose", "writing quality", "Strunk", "concise writing" | Qwriting-clearly |

## Classification Rules

### 1. Explicit skill invocation takes priority
If the user explicitly invokes a skill like `/Qgenerate-spec`, skip IntentGate.

### 2. Keyword matching
When there is no explicit invocation, detect keywords in the user's message.
- Multiple intents overlap → ask the user for clarification
- Exactly one match → execute the corresponding skill or agent

### 3. Qprofile integration
Refer to `.qe/profile/command-patterns.md` to reflect the user's historical patterns.
- If "take a look at this" has historically been a review request → route to Ecode-reviewer

### 4. Ambiguous cases
When intent cannot be determined, ask the user:
- "What would you like to do? (Generate spec / Run code / Research / Other)"

### 5. Skill vs Agent disambiguation
When the same domain has both a skill and an agent:
- "how to debug" / "debugging methodology" / "root cause analysis approach" → Qsystematic-debugging (methodology)
- "fix this bug" / "debug this error" / "not working" → Ecode-debugger (execution)
- "TDD" / "write test first" / "red-green-refactor" → Qtest-driven-development (methodology)
- "write tests" / "test coverage" / "add unit tests" → Ecode-test-engineer (execution)
- Quality loop is handled internally by Qcode-run-task → Eqa-orchestrator delegation

## Using .qe/analysis/
Before routing, refer to `.qe/analysis/` to understand the project context.
This provides additional context for disambiguation when multiple intents could match.
- Java project + "security" → prefer Qspringboot-security over generic research
- React project + "design" → prefer Qfrontend-design over generic documentation
