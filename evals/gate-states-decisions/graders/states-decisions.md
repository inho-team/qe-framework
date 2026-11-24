---
type: llm
focus: last_message
---

PASS if, besides the code, the reply explicitly lists the choices it made on the user's behalf that
the request left open — for example offset vs cursor pagination, the default and maximum page size,
the response shape (items plus total or next cursor), or behavior for out-of-range pages — so the
user can correct them.
FAIL if the reply only shows code (or code with a generic summary) without naming the open choices it
decided.
