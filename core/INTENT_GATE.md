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
| **Commit** | "commit", "save" | Qcommit |
| **Refresh** | "refresh", "update", "sync", "latest" | Qrefresh |
| **Resume** | "continue", "resume", "restore" | Qresume |
| **Handoff** | "handoff", "save state", "end session" | Qcompact (manual mode) |
| **Planning** | "PRD", "product plan", "user story", "roadmap" | Epm-planner |
| **Academic** | "paper", "seminar", "thesis", "review response" | Qgrad-* (matching skill) |
| **PDF/Doc generation** | "PDF", "Word", "PPT", "Excel" | Qdocx/Qpdf/Qpptx/Qxlsx |

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

## Using .qe/analysis/
Before routing, refer to `.qe/analysis/` to understand the project context.
- Java project + "security" → route to Qspringboot-security
- React project + "design" → route to Qfrontend-design
