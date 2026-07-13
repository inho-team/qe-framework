# State - qe-mcp-expert-refresh

- **Active Phase**: Phase 1 — Source Map And Review Schema

## Current Focus

Establish canonical source ownership and review metadata before refreshing expert content.

## Phase Progress

> 자동 생성 (ledger.mjs render-state) — 직접 수정 금지

### Phase 1 - Source Map And Review Schema
- [x] G001 [Waves] Confirm canonical source for core-experts in ../qe-mcp.
- [x] G002 [Waves] Confirm canonical source for extra-experts: installed pack vs source repo vs generated artifact.
- [x] G003 [Waves] Map expert name to source file, index entry, pack, and installed location.
- [x] G004 [Waves] Record which files are generated and which are authoritative.
- [x] G005 [Waves] Extend or document review metadata fields: status, last reviewed date, source date, source URLs/commands, current major,
- [x] G006 [Waves] Define valid lifecycle values: trusted-current, use-with-caution, legacy.
- [x] G007 [Waves] Decide default for missing metadata: use-with-caution or legacy, never trusted-current.
- [x] G008 [Waves] Run npm run build:index, npm test, npm run lint:size, and qe-mcp packs status --json.
- [x] G009 [Waves] Capture baseline counts: core 25, extra 61, total 86.
- [x] G010 [Waves] Verify direct reads still work for representative experts.

### Phase 2 - High-Risk Expert Refresh
- [x] G011 [Waves] Refresh Qnextjs-developer for Next.js 16 defaults, RSC/security notes, current App Router behavior, agent-debugging feat
- [x] G012 [Waves] Refresh Qangular-architect for Angular 22 defaults and signal/standalone guidance.
- [x] G013 [Waves] Refresh Qvite and Qvitest for current Vite/Vitest config and migration notes.
- [x] G014 [Waves] Refresh Qdjango-expert for Django 6 current behavior and Django 5 LTS/legacy notes.
- [x] G015 [Waves] Refresh Qrails-expert for Rails 8 current defaults and Rails 7 legacy notes.
- [x] G016 [Waves] Refresh Qlaravel-specialist after verifying Laravel current major through official Composer/docs.
- [x] G017 [Waves] Refresh Qnestjs-expert for NestJS 11 compatibility.
- [x] G018 [Waves] Refresh Qfine-tuning-expert with current provider APIs and model/date caveats.
- [x] G019 [Waves] Refresh Qrag-architect with current embedding/vector database guidance and source dates.
- [x] G020 [Waves] Tag volatile provider/model defaults with explicit source date.

### Phase 3 - Staleness Gates And Recommendation Behavior
- [ ] G021 [Waves] Add a script that scans explicit major-version anchors in expert descriptions and SKILL.md files.
- [ ] G022 [Waves] Compare known package ecosystems through configurable registry probes or a checked-in current-major manifest.
- [ ] G023 [Waves] Fail or warn when an expert is two or more majors behind without legacy classification.
- [ ] G024 [Waves] Update qe-mcp expert recommendation logic to prefer trusted-current.
- [ ] G025 [Waves] Keep legacy experts readable by name.
- [ ] G026 [Waves] Surface lifecycle class in search/recommend JSON output.
- [ ] G027 [Waves] Add tests for metadata schema, lifecycle values, deterministic index generation, direct read compatibility, and recommen
- [ ] G028 [Waves] Verify qe-mcp expert search, qe-mcp expert recommend, qe-mcp expert read, qe-mcp packs status --json.

### Phase 4 - Rollout And Operating Cadence
- [ ] G029 [Waves] Install or sync refreshed qe-mcp locally.
- [ ] G030 [Waves] Run qe-mcp init-registry, qe-mcp sync, qe-mcp doctor, qe-mcp sync --dry-run.
- [ ] G031 [Waves] Verify Codex/Claude can read refreshed experts through MCP tools.
- [ ] G032 [Waves] Prepare release notes listing refreshed experts and remaining use-with-caution/legacy items.
- [ ] G033 [Waves] Publish or package only after tests pass.
- [ ] G034 [Waves] Confirm installed package reports expected version and pack counts.
- [ ] G035 [Waves] Generate the next batch list for security, cloud, database, PM/product, and design experts.
- [ ] G036 [Waves] Create a 90-day review cadence and stale warning threshold.
