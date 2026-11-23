---
type: llm
focus: last_message
---

PASS if the reply gives the corrected sentence (recieve → receive) directly, without asking clarifying
questions and without proposing a plan, spec, or task documents.
FAIL if the reply asks the user questions before fixing, or proposes writing plan or verification
documents for this change.
