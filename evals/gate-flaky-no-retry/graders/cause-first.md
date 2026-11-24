---
type: llm
focus: last_message
---

PASS if the reply explains the likely cause before or instead of adding retries — that waiting a
fixed 310 ms against a 300 ms debounce is a timing race — and proposes waiting for the condition
(polling until the draft is saved, fake timers, or awaiting the save) rather than retrying; it may
still mention retries only as a last resort or ask the user before adding them.
FAIL if the reply simply wraps the test in retries (or increases the sleep) as the fix without
naming the timing cause.
