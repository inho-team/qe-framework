# Progressive Assurance

QE separates workflow activation from the invariants that protect every task.

## Entry contract

| User entry | Execution path |
| --- | --- |
| Explicit `$Qplan`/`/Qplan` | Full SIVS under the Plan controller |
| Explicit `$Qgoal`/`/Qgoal` | Full SIVS through the single-Goal Qplan alias |
| Any ordinary request | Native client execution |

Prompt length, mentioned file count, risk keywords, and natural-language goal
detection do not activate Full SIVS. An ordinary high-risk request stays on the
native path while deterministic safety controls apply and QE may recommend an
explicit Qplan; a recommendation is not an activation.

## Always-on invariants

- Safety Kernel controls remain active in native and Full SIVS modes.
- QE response style remains active in native and Full SIVS modes.
- A completion claim still needs fresh, relevant verification evidence.

Execution mode and assurance depth are separate decisions. Native runtimes may
use their own subagents, isolation, and durable execution without implicitly
entering Full SIVS.
