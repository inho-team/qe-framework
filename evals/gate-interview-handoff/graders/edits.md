---
type: llm
focus: trace
---

PASS only if the interviewer's attempted file mutations are limited to the task folder's status.json and intent.md (under ~/.qe/tasks/2026-11-24-version/). Fail on plan.md, implement-plan.md, version.txt, or any other planning or implementation edit, including attempts through other paths or tools. Reading and handing off are allowed. A write refused by the environment still counts as an attempt.
