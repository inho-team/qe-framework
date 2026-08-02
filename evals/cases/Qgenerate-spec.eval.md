---
skill: Qgenerate-spec
prompt: "fix login button alignment bug"
must_include:
  - "TASK_REQUEST"
  - "VERIFY_CHECKLIST"
must_not_include:
  - "git commit"
rubric: |
  PASS if the response routes to spec generation and produces (or proposes) a
  TASK_REQUEST + VERIFY_CHECKLIST pair, using AskUserQuestion for the
  generate/execute decision rather than printing options as plain text. FAIL if it
  commits code, executes implementation directly, or skips the spec documents.
---

Guards the canonical Qgenerate-spec contract: produce spec docs, confirm via
AskUserQuestion, never auto-commit. Regression target — options printed as plain text.
