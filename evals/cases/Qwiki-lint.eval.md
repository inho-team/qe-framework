---
skill: Qwiki-lint
prompt: "위키 점검해줘 — 모순이나 깨진 링크 있나"
must_include:
  - "Contradiction"
  - "고아"
must_not_include:
  - "git commit"
rubric: |
  PASS if it runs the 7 checks — contradictions (⚠️ Contradiction grep), orphans, dead
  links, index/router count consistency, shard token cap (via wiki-router), tier sync,
  and conventions↔wiki-router consistency — auto-fixing only high-confidence items and
  reporting the rest. IDEMPOTENCY (LLM-judge expectation): re-running lint on a clean
  wiki reports zero new issues and makes zero changes. FAIL if it edits raw/, commits,
  or bootstraps auto-generated.md (that is compile's job — lint only validates it).
---

Guards the 7-check lint contract + idempotency. The idempotency clause is an LLM-judge
rubric assertion, not a deterministic check.
