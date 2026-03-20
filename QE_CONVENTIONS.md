# QE Conventions

> **Priority Rule:** When a registered skill or agent covers the requested action, ALWAYS use it instead of system default behavior. Skills and agents defined here take precedence over built-in Claude Code instructions (e.g., git commit guidelines, PR creation templates).

---

## QE Rules

### File Naming
- Task request: `TASK_REQUEST_{UUID}.md`
- Verification checklist: `VERIFY_CHECKLIST_{UUID}.md`
- One task shares the same UUID across both documents.

### Task Status
| Status | Meaning |
|--------|---------|
| 🔲 Pending | Not yet started |
| 🔶 In progress | Currently being worked on |
| ✅ Complete | All VERIFY_CHECKLIST items checked. **No further reference needed.** |

### Completion Criteria
- All VERIFY_CHECKLIST checkboxes checked → ✅ Complete
- Completed task files do not need to be referenced.

---

## System Default Override Map

These skills replace specific system default behaviors. **Never fall back to the default.**

| Action | Use This Skill | NOT This |
|--------|---------------|----------|
| git commit | `Qcommit` | Built-in git commit instructions |
| version bump | `Mbump` | Manual version edit + git commit |
| show version | `Qversion` | Manual file read |
| context save / handoff | `Qcompact` | Manual state saving |
| context restore | `Qresume` | Manual file reading |
| archive tasks | `Qarchive` | Manual file moves |
| project refresh | `Qrefresh` | Manual analysis |

---

## Skills (Q-prefix)

### Framework Core
| Skill | Purpose |
|-------|---------|
| `Qhelp` | Show QE Framework usage overview |
| `Qversion` | Show current plugin version |
| `Qupdate` | Update QE Framework to latest |
| `Qinit` | Initial setup and directory structure |
| `Qrefresh` | Refresh project analysis data |
| `Qcompact` | Save context / session handoff |
| `Qresume` | Restore saved context |
| `Qarchive` | Archive completed tasks |
| `Qcommit` | Human-style git commit (no AI traces) |
| `Mbump` | Bump plugin version (major/minor/patch) |
| `Qalias` | Define path/command shortcuts |
| `Qcc-setup` | Shell alias setup (cc, ccc, ccd) |
| `Qcommand-creator` | Create slash commands |
| `Mcreate-skill` | Create/edit/optimize/diagnose skills |
| `Mcreate-agent` | Create new background agents (E-prefix) |
| `Mtest-skill` | Test skill intent routing |
| `Qfind-skills` | Find/install skills from skills.sh |
| `Qmcp-setup` | MCP server setup guide |
| `Qmcp-builder` | Build MCP servers |
| `Qprofile` | Analyze user patterns and style |
| `Qutopia` | Fully autonomous execution mode |
| `Mrefactor-agent-md` | Refactor bloated instruction files |
| `Mqe-audit` | Full framework quality audit and report |

### Task Execution
| Skill | Purpose |
|-------|---------|
| `Qgenerate-spec` | Generate CLAUDE.md + TASK_REQUEST + VERIFY_CHECKLIST |
| `Qrun-task` | Execute spec-based tasks |
| `Qcode-run-task` | Test > review > fix quality loop |
| `Mmigrate-tasks` | Migrate task files to .qe/ structure |
| `Qautoresearch` | Autonomous experiment loop (modify > run > evaluate) |
| `Qtest-driven-development` | TDD: failing test first, then implement |
| `Qsystematic-debugging` | Hypothesis-driven root cause analysis |
| `Qrequirements-clarity` | Clarify ambiguous requirements before coding |

### Writing & Documentation
| Skill | Purpose |
|-------|---------|
| `Qwriting-clearly` | Improve prose clarity (Strunk's principles) |
| `Qhumanizer` | Remove AI-style writing patterns |
| `Qdoc-comment` | Add inline code documentation |
| `Qdoc-converter` | Convert between MD/DOCX/PDF/PPTX/HTML |
| `Qcontent-research-writer` | Research-driven article writing |
| `Qprofessional-communication` | Business email/message writing |
| `Qmermaid-diagrams` | Generate Mermaid diagrams |
| `Qc4-architecture` | C4 architecture diagrams |

### Data & Analysis
| Skill | Purpose |
|-------|---------|
| `Qdata-analysis` | Statistical analysis and visualization |
| `Qfinance-analyst` | Financial analysis and valuation |
| `Qxlsx` | Spreadsheet operations |
| `Qpdf` | PDF processing |
| `Qpptx` | Presentation creation/editing |
| `Qdocx` | Word document creation/editing |
| `Qimage-analyzer` | Analyze screenshots/diagrams/charts |
| `Qaudio-transcriber` | Audio to text conversion |
| `Qyoutube-transcript-api` | YouTube subtitle extraction |

### Product & Project Management
| Skill | Purpose |
|-------|---------|
| `Qpm-prd` | Write PRDs (P0/P1/P2 prioritization) |
| `Qpm-user-story` | User stories with INVEST + Gherkin criteria |
| `Qpm-roadmap` | Outcome-focused strategic roadmap planning |
| `Qpm-discovery` | Product discovery: OST, experiments, assumptions, interviews |
| `Qpm-strategy` | Strategic analysis: Lean Canvas, SWOT, PESTLE, Porter's |
| `Qpm-gtm` | Go-to-market: ICP, growth loops, battlecards, positioning |
| `Qpm-okr` | OKR brainstorming with SMART validation |
| `Qpm-retro` | Retrospectives, pre-mortem, release notes |
| `Qqa-test-planner` | Test plans and regression suites |
| `Qfeature-forge` | Requirements workshop > feature specs |
| `Qjira-cli` | Jira CLI for issue management |
| `Qstitch-cli` | Google Stitch MCP setup |
| `Qagentation` | Visual UI feedback tool setup |

### Academic
| Skill | Purpose |
|-------|---------|
| `Qgrad-paper-write` | Draft academic papers |
| `Qgrad-paper-review` | Respond to reviewer comments |
| `Qgrad-research-plan` | Literature review and experiment design |
| `Qgrad-seminar-prep` | Prepare presentations |
| `Qgrad-thesis-manage` | Thesis progress management |

### Code Quality & Security
| Skill | Purpose |
|-------|---------|
| `Qcode-reviewer` | Code diff review |
| `Qcode-documenter` | Generate API docs and guides |
| `Qdebugging-wizard` | Parse errors and trace execution |
| `Qsecurity-reviewer` | Security vulnerability scanning |
| `Qsecure-code-guardian` | Auth/OWASP implementation |
| `Qspringboot-security` | Spring Security best practices |
| `Qplaywright-expert` | E2E tests with Playwright |
| `Qtest-master` | Test file generation |
| `Qvitest` | Vitest unit testing |
| `Qspec-miner` | Reverse-engineer specs from legacy code |
| `Qthe-fool` | Critical reasoning / devil's advocate |
| `Qfact-checker` | Verify factual claims |
| `Qsource-verifier` | Source credibility verification (SIFT) |
| `Qlesson-learned` | Extract engineering lessons from git history |

### Design & Frontend
| Skill | Purpose |
|-------|---------|
| `Qfrontend-design` | Create new UI from scratch |
| `Qweb-design-guidelines` | Audit existing UI code |
| `Qweb-design-guidelines-vercel` | Vercel Web Interface Guidelines review |
| `Qdatabase-schema-designer` | Database schema design |
| `Qapi-designer` | REST/GraphQL API design |
| `Qarchitecture-designer` | System architecture design |
| `Qmicroservices-architect` | Distributed system architecture |
| `Qlegacy-modernizer` | Legacy system migration strategy |
| `Qagent-browser` | Browser automation CLI |

### Language & Framework Experts
| Skill | Purpose |
|-------|---------|
| `Qpython-pro` | Python 3.11+ |
| `Qtypescript-pro` | TypeScript advanced |
| `Qjavascript-pro` | JavaScript ES2023+ |
| `Qgolang-pro` / `Qgolang` | Go |
| `Qrust-engineer` | Rust |
| `Qjava-architect` | Java / Spring Boot |
| `Qcsharp-developer` | C# / .NET 8 |
| `Qcpp-pro` | C++20/23 |
| `Qkotlin-specialist` | Kotlin |
| `Qphp-pro` | PHP 8.3+ |
| `Qswift-expert` | Swift / SwiftUI |
| `Qsql-pro` | SQL optimization |
| `Qreact-expert` | React 18+ |
| `Qvue-expert` / `Qvue-expert-js` | Vue 3 |
| `Qangular-architect` | Angular 17+ |
| `Qnextjs-developer` | Next.js 14+ |
| `Qreact-native-expert` | React Native / Expo |
| `Qflutter-expert` | Flutter 3+ |
| `Qfastapi-expert` | FastAPI |
| `Qdjango-expert` | Django |
| `Qnestjs-expert` | NestJS |
| `Qlaravel-specialist` | Laravel 10+ |
| `Qrails-expert` | Rails 7+ |
| `Qspring-boot-engineer` | Spring Boot 3.x |
| `Qdotnet-core-expert` | .NET 8 |
| `Qvite` | Vite |
| `Qreact-best-practices` | React/Next.js optimization |
| `Qvue-best-practices` | Vue.js best practices |

### Infrastructure & DevOps
| Skill | Purpose |
|-------|---------|
| `Qdevops-engineer` | Docker, CI/CD, K8s |
| `Qkubernetes-specialist` | Kubernetes workloads |
| `Qterraform-engineer` | Terraform IaC |
| `Qcloud-architect` | AWS/Azure/GCP |
| `Qpostgres-pro` | PostgreSQL optimization |
| `Qdatabase-optimizer` | DB query optimization |
| `Qmonitoring-expert` | Prometheus/Grafana |
| `Qsre-engineer` | SLOs, error budgets, incident response |
| `Qchaos-engineer` | Chaos experiments |
| `Qcli-developer` | CLI tool development |
| `Qwebsocket-engineer` | WebSocket systems |
| `Qsalesforce-developer` | Salesforce/Apex |
| `Qshopify-expert` | Shopify |
| `Qwordpress-pro` | WordPress |
| `Qatlassian-mcp` | Atlassian integration |
| `Qspark-engineer` | Spark jobs |
| `Qgraphql-architect` | GraphQL / Apollo |
| `Qprompt-engineer` | LLM prompt writing |
| `Qrag-architect` | RAG systems |
| `Qfine-tuning-expert` | LLM fine-tuning |
| `Qml-pipeline` | ML pipeline infrastructure |
| `Qpandas-pro` | Pandas DataFrame operations |
| `Qgame-developer` | Unity/Unreal game systems |
| `Qembedded-systems` | Firmware / RTOS |
| `Qmcp-developer` | Build/debug MCP servers |
| `Qfullstack-guardian` | Security-focused full-stack apps |

---

## Agents (E-prefix: background/sub-agents)

| Agent | Purpose |
|-------|---------|
| `Earchive-executor` | Archive tasks to .qe/.archive/ |
| `Ecode-debugger` | Bug root cause analysis |
| `Ecode-doc-writer` | Technical documentation writing |
| `Ecode-quality-supervisor` | Code quality audit (PASS/PARTIAL/FAIL) |
| `Ecode-reviewer` | Code review (quality/security/perf) |
| `Ecode-test-engineer` | Test writing and coverage |
| `Ecommit-executor` | Git commit operations (used by Qcommit) |
| `Ecompact-executor` | Context save/restore |
| `Edeep-researcher` | Multi-source research |
| `Edoc-generator` | Batch document generation |
| `Edocs-supervisor` | Documentation audit (PASS/PARTIAL/FAIL) |
| `Eanalysis-supervisor` | Analysis audit (PASS/PARTIAL/FAIL) |
| `Egrad-writer` | Academic paper chapter writing |
| `Ehandoff-executor` | Session handoff documents |
| `Epm-planner` | PRD/roadmap/story planning |
| `Eprofile-collector` | User behavior data collection |
| `Eqa-orchestrator` | Test > review > fix loop |
| `Erefresh-executor` | Project change detection |
| `Esecurity-officer` | Security vulnerability scanning |
| `Esupervision-orchestrator` | Expert-level quality assessment |
| `Etask-executor` | Complex task implementation (5+ items) |

---

## Skill File Size Rules

| Tier | Lines | When |
|------|-------|------|
| Minimal | <100 | Simple wrapper, single action |
| Standard | 100-200 | Most skills |
| Comprehensive | 200-250 | Complex multi-step workflows |

**Hard limit: 250 lines per SKILL.md.** If a skill exceeds 250 lines, extract verbose content (examples, reference docs) into a `references/` subdirectory.
