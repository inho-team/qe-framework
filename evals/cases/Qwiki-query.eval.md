---
skill: Qwiki-query
prompt: "위키에서 나폴레옹 전술에 대해 뭐 알아?"
must_include:
  - "Phase A"
  - "Phase B"
must_not_include:
  - "git commit"
rubric: |
  PASS if it does 2-phase routing — Phase A (route) reads ONLY routers + aliases.md and
  never opens shards, Phase B (search) opens the minimal shard set, follows [[links]] 1
  hop, and cites with provenance. Valuable answers are filed back to .qe/wiki/queries/.
  TOKEN-BUDGET invariant (asserted in skill text): Phase A must not load shards/whole
  index. FAIL if it loads the entire wiki, skips provenance, or writes outside queries/.
---

Guards the Phase A/B routing contract and the token-budget invariant (Phase A = no shard
reads). Runtime adherence is only confirmable via this behavioral eval, not by grep.
