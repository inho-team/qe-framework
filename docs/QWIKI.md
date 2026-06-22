# Qwiki — Project Knowledge Wiki

Qwiki turns a QE-activated project into a **maintained markdown wiki** following
Andrej Karpathy's "LLM Wiki" pattern: instead of re-searching raw sources on every
question (RAG), the LLM **synthesizes once and accumulates** into a routed,
provenance-backed knowledge base under `.qe/wiki/`.

> Origin: adapted from `github.com/fivetaku/llm-wiki`. Adoption decision: DECISION_LOG
> D-WIKI-01 (`.qe/planning/plans/qe-wiki/`).

## When to use

Use Qwiki to accumulate durable **project knowledge** — entities, concepts, source
summaries, decisions — that should compound across sessions. It does **not** replace:

| Layer | Role | Boundary (D-WIKI-02) |
|-------|------|----------------------|
| `Qmemory` | volatile fact cards (TTL) | wiki is canonical; memory is a pointer/cache |
| `Qcontext` | per-folder CLAUDE.md loading | orthogonal — loading ≠ knowledge |
| `.qe/analysis` | code-structure snapshot (auto, overwritten) | code is not a raw source; never promoted to wiki sources |

## 3-Layer structure

```
.qe/wiki/
├── conventions.md      # schema (seeded from core/wiki-conventions.template.md)
├── inbox/              # uncompiled sources (queue)
├── raw/                # immutable originals (+ raw/assets/)
└── pages/              # LLM-owned wiki
    ├── index.md        # root router (MOC, not a catalog)
    ├── log.md
    └── {topic}/        # index.md · aliases.md · overview.md · indexes/ · sources/ · entities/ · concepts/
```

## 4-verb workflow

```
/Qwiki-ingest  → save a URL/file/text into .qe/wiki/inbox (save only, no synthesis)
/Qwiki-compile → synthesize inbox → pages: canonicalize, update router/indexes/overview,
                 move original to raw/, Socratic gate, commit via Qcommit
/Qwiki-query   → 2-phase routed retrieval (Phase A route, Phase B search) + cite, fileback
/Qwiki-lint    → 7 checks: contradictions, orphans, dead links, index/router consistency,
                 shard cap, tier sync, conventions↔router consistency
```

## Routing (token cost stays flat as the wiki grows)

- **Router, not catalog**: `pages/index.md` decides intent → topic/shard; it never lists
  entities. Entity lines live in `indexes/{type}.md`.
- **Canonicalization**: `aliases.md` maps surface forms → one canonical name (the shard key).
- **Sharding**: type indexes split by canonical first char at ≤50K tokens; Korean canonicals
  go to a separate `ko` shard. Authority: `scripts/lib/wiki-router.mjs`.
- **2-phase query**: Phase A reads only routers + aliases (never opens shards); Phase B opens
  the minimal shard set and follows `[[links]]` one hop.

## QE integration

- **Commits**: `/Qwiki-compile` commits **only via Qcommit → Ecommit-executor** — raw
  `git commit` is hard-blocked by the PreToolUse hook (D-WIKI-01).
- **SIVS**: compile/query/lint are **Claude-only** (not SIVS stages).
- **SessionStart hook**: shows `[Wiki] N uncompiled …` when `.qe/wiki/inbox` has sources.
- **HUD**: the opt-in `wiki` preset (`/Qhud on --preset wiki`) shows topic + inbox counts.
  Existing presets are unchanged.
- **Provenance**: every factual claim backlinks `[[sources/...]]` (extracted / inferred /
  ambiguous / web-enriched). The Socratic gate holds inferred/ambiguous/contradictions for
  human confirmation before `tier: reviewed`.

## Knowledge flywheel (work → wiki)

The wiki compounds by ingesting the framework's **own** knowledge artifacts:

```
node <QE plugin>/scripts/lib/wiki-seed.mjs --seed-self   # seed DECISION_LOG/MISTAKE/RETROSPECTIVE → inbox
/Qwiki-compile                                            # synthesize into pages (gated, no --batch)
```

- **Seeds only**: `DECISION_LOG.md`, `MISTAKE.md`, `RETROSPECTIVE.md` files.
- **Never seeds**: `.qe/analysis/*` (auto-derived code snapshot, D-WIKI-02) or `.qe/wiki/` output
  (queries/pages — would create a self-ingestion loop).
- **Self-reference guard**: seeds carry `seed_origin: framework-self` + `seed_provenance: inferred`;
  Qwiki-compile synthesizes them as `provenance: inferred` (`(추론)` mark + Socratic gate) and
  **refuses `--batch` gate-skip** for them — so AI-authored knowledge can't launder into unmarked fact.
- **Idempotent**: `.qe/wiki/.seed-state.json` supersedes in place (no duplicates on re-seed).
- **Trigger**: manual or at milestone boundaries only — **never an automatic hook** (avoids runaway,
  noise, and seeding stale artifacts). `/Qinit` offers an opt-in bootstrap at setup.

## Complementary tools

`understand-anything:understand-knowledge` produces a graph **visualization** of an
LLM-wiki — it can take `.qe/wiki/pages/` as input, but does not replace the maintained
wiki (visualization vs. canonical store).

## Reference

- `core/wiki-conventions.template.md` — full page/index/routing spec
- `scripts/lib/wiki-router.mjs` — canonicalization + sharding authority
- `.qe/planning/plans/qe-wiki/` — plan, decisions, phase artifacts
