# Upgrade Guide: v6.x → v7.0

> QE Framework v7.0 — Harness Engineering Upgrade

---

## Breaking Changes

**None.** v7.0 is fully backward-compatible with v6.x projects.

- Existing sivs-config.json files continue to work unchanged
- All 9 original hook handlers are untouched
- No external dependencies added (still zero deps)
- Existing tests pass without modification

## New Features by Phase

### Phase 1: Hook System Overhaul
- effort parameter support, Skill Budget monitoring, harness metrics
- 5 new functional handlers: PostToolUseFailure (error streak), SubagentStart/Stop (lifecycle tracking), FileChanged (ContextMemo invalidation), SessionEnd (cleanup)
- 13 stub handlers ready for customization

### Phase 2: SIVS & API Modernization
- `effort` parameter support: `max` for Claude, `xhigh` for Codex (auto-mapped)
- `compaction` settings in sivs-config: server/client/auto strategy
- Backward-compatible: `budget_tokens` auto-converts to `effort`
- Managed Agents API compatibility types

### Phase 3: Plugin & Skill Governance
- Plugin marketplace v2 metadata (homepage, license, keywords, tags)
- **Skill Budget monitoring**: Warns when 183+ skills approach context 1% threshold
- Skill deduplication audit report (20 clusters identified)

### Phase 4: Multi-Agent Orchestration
- Agent Teams v2 with 16-field `--agents` configuration
- JSON Schema validation for Agent Teams config
- Dynamic Workflows documentation (Opus 4.8)
- Cross-session memory patterns guide

### Phase 5: Observability & Measurement
- 6 harness engineering metrics (Task Resolution, Code Churn, Verification Tax, Constraint Effect, Defect Escape, Pass@1)
- Session telemetry JSONL export (.qe/telemetry/)
- Agent decision tracing (.qe/traces/)
- HUD metrics summary panel

### Phase 6: Documentation
- CLAUDE.md updated with v7.0 numbers and pointers
- Import System pattern guide
- This upgrade guide

## New Configuration Options

### effort in sivs-config.json
```json
{
  "spec": { "engine": "claude", "effort": "max" },
  "implement": { "engine": "claude", "effort": "high" }
}
```

Values: `low`, `medium`, `high`, `max` (Claude) / `xhigh` (Codex)

### compaction in sivs-config.json
```json
{
  "spec": {
    "compaction": { "enabled": true, "strategy": "server" }
  }
}
```

Strategies: `server` (API-side), `client` (local), `auto` (best available)

## Activating New Hooks

New hooks are registered automatically. To customize a stub handler:

1. Open `hooks/scripts/{event-name}.mjs`
2. Replace the `// TODO` comment with your logic
3. Use the existing pattern: `readStdinJson()` → process → `JSON.stringify({ continue: true })`

## Skill Budget Warnings

If you see `[QE] Skill budget overflow` at session start:
- Run the skill dedup audit to identify merge candidates
- Consider consolidating similar skills (e.g., Qvue-expert + Qvue-best-practices)
- Use `/Qhelp` to see current skill count and budget status

## Recommended Update Steps

1. `npm update @inho-team/qe-framework` (or reinstall)
2. Verify: `npm run qe:validate` (checks sivs-config compatibility)
3. Optional: Add `effort` to your sivs-config.json
4. Optional: Enable compaction if using Opus 4.6+ Compaction API
5. Check `/Qhelp` for skill budget status
