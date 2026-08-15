# Progressive Assurance

QE separates workflow activation from the invariants that protect every task.

## Entry contract

| User entry | Execution path |
| --- | --- |
| Explicit `$Qplan`/`/Qplan` | Full SIVS under the Plan controller; eligible low-risk micro work uses its bounded micro-Goal lane |
| Explicit `$Qgoal`/`/Qgoal` | Full SIVS through the single-Goal Qplan alias, with the same lane selection |
| Any ordinary request | Native client execution |

Prompt length, mentioned file count, risk keywords, and natural-language goal
detection do not activate Full SIVS. An ordinary high-risk request stays on the
native path while deterministic safety controls apply and QE may recommend an
explicit Qplan; a recommendation is not an activation.

For an ordinary goal-like request, the advisory router scans visible prose for
the same high-impact categories enforced by Goal acceptance: authentication,
authorization, payment, deployment, data migration, destructive data change,
external integration, and security. A match adds an explicit Qplan
recommendation to the native-path hint. It does not issue a pipeline marker,
change execution mode, or treat examples inside fenced code and quote blocks as
user intent.

## Always-on invariants

- Safety Kernel controls remain active in native and Full SIVS modes.
- QE response style remains active in native and Full SIVS modes.
- A completion claim still needs fresh, relevant verification evidence.

Execution mode and assurance depth are separate decisions. Native runtimes may
use their own subagents, isolation, and durable execution without implicitly
entering Full SIVS.

Within explicit Full SIVS, Qplan selects assurance depth after reconnaissance.
The bounded micro-Goal lane replaces formal Spec/Supervise fan-out with an
immutable executable acceptance contract, while preserving locked commands,
TDD when applicable, regression evidence, and independent final verification.
All ambiguous or initially high-impact Goals use the formal lane. If an admitted
micro Goal later expands, discovers high-impact risk, or fails verification, it
is auditably blocked and a linked formal successor Plan/Goal is created; the
immutable micro contract is never rewritten.
