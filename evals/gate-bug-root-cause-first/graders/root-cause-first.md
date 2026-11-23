---
type: llm
focus: last_message
---

PASS if the reply identifies a concrete root cause before or together with any fix — for example that the
discount is applied per item with fractional results and rounding happens only once at the end, or that
floating-point error accumulates — and either proposes a reproducing test/example first or explains how to
confirm the cause. Asking for a failing example to confirm the cause also passes.
FAIL if the reply only patches the symptom without naming why it happens (for example adding toFixed,
Math.floor, or an epsilon without explaining the cause), or guesses several unrelated fixes at once.
