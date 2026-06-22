---
skill: Qwiki-ingest
prompt: "이 URL 위키에 넣어줘 https://example.com/article"
must_include:
  - ".qe/wiki/inbox"
  - "저장"
must_not_include:
  - "30-wiki"
rubric: |
  PASS if it routes to saving the source into .qe/wiki/inbox/ ONLY (no wiki-ization)
  and does NOT synthesize pages — that is Qwiki-compile's job. Binary inputs should
  fall back to markitdown opt-in, degrading gracefully (still saves) when absent.
  FAIL if it builds wiki pages, edits raw/, or commits.
---

Guards the ingest = save-only contract: source lands in .qe/wiki/inbox, no synthesis,
graceful markitdown fallback. NOT-trigger: compile/query/lint, raw edits.
