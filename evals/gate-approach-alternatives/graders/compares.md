---
type: llm
focus: last_message
---

PASS if the reply, before planning or code, presents at least two concrete ways to handle the `--due` argument (for example node:util parseArgs, extending the existing manual argv slicing, or a CLI library) with what each costs or how they differ on inputs like `--due=2026-12-01`, a missing value, or a title-less add, and recommends one; OR states that only one way fits while naming the alternatives it rejected and why.
FAIL if it goes on without naming any alternative way to parse the argument (for example saying there is essentially one approach), or jumps straight to a plan or code.
