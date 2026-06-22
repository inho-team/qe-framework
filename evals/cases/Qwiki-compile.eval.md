---
skill: Qwiki-compile
prompt: "inbox에 모아둔 소스 위키로 정리해줘"
must_include:
  - "정본화"
  - "Qcommit"
must_not_include:
  - "git commit -m"
rubric: |
  PASS if it synthesizes .qe/wiki/inbox sources into pages (source/entity/concept),
  canonicalizes via wiki-router, updates routers/indexes/overview, moves originals to
  raw/, runs the Socratic gate, and commits ONLY through Qcommit (never raw git commit).
  IDEMPOTENCY (LLM-judge expectation): re-running compile on an already-compiled inbox
  must produce zero duplicate pages and zero duplicate index lines (dedup-check before
  create). FAIL if it calls raw git commit, edits raw/, or duplicates entities.
---

Guards the compile pipeline + Qcommit-only commit + idempotency expectation. The
idempotency clause is an LLM-judge rubric assertion (skills are LLM-executed), not a
deterministic unit check — wiki-router determinism is unit-tested separately.
