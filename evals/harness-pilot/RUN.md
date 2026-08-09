# Progressive Assurance Harness Pilot

- Status: **INVALID — actor authentication failed in all 20 cells**
- Model: sonnet
- Revision: 96ce6dea08ef72a050d39eba23f296fe48e303fd
- Balanced task/repetition pairs: 5
- Runs: 20

| Condition | Success | Input tokens | Output tokens | Wall seconds |
|---|---:|---:|---:|---:|
| native-ephemeral | 0.000 | 0.0 | 0.0 | 0.5 |
| native-durable | 0.000 | 0.0 | 0.0 | 0.4 |
| full-sivs-ephemeral | 0.000 | 0.0 | 0.0 | 0.4 |
| full-sivs-durable | 0.000 | 0.0 | 0.0 | 0.4 |

> Pilot only: one repetition cannot establish production effectiveness.

All actor processes exited before a model turn because the configured Claude
organization disabled Claude Code subscription access. Every cell recorded zero
input/output tokens, an empty patch, and zero cost. The table above is retained
only as failure evidence and must not be interpreted as a QE effectiveness result.
