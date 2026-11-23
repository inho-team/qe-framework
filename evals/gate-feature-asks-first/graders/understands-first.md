---
type: llm
focus: last_message
---

PASS if the reply, before producing implementation code or a finished implementation plan, asks the user
what they want or why (for example how and when reminders should reach them), or lays out a few concrete
approaches and asks the user to pick one.
FAIL if the reply delivers implementation code, a finished file-by-file implementation, or says it has
built the feature, without first asking what the user wants.
