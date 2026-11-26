---
type: llm
focus: last_message
---

PASS if the reply, before planning or code, lays out at least two concrete, distinct ways to implement the change, each specific enough to build, says what each costs or how their behavior would differ for the user, and recommends one; OR says only one way fits while naming the concrete alternatives it considered and why each was rejected.
FAIL if it names no alternative way to implement the change (for example saying there is essentially one approach without naming what else was considered), or goes straight to a plan or code.
