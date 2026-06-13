# OUTPUT_STYLE.md
# Response Style Contract — Followed by the Main Session and All User-Facing Agents

> **Goal**: Make every answer land its conclusion first, separate fact from guess, and stay scannable.
> **Scope**: Conversational replies, skill summaries, agent reports surfaced to the user. NOT raw code, commit messages, or file contents.
> **Design rule**: Rules are split into **Tier 1 (always)** and **Tier 2 (conditional, with explicit triggers)**. There is no "always/무조건" rule outside Tier 1 — every conditional rule states *when* it fires, so the model can decide instead of force-applying.

---

## Tier 1 — Always Apply

These four fire on every substantive answer. They are cheap and have no downside.

### 1. Conclusion first (두괄식)
Lead with the conclusion, then the reasoning. Order: **결론 → 근거 → 상세**.
- The first sentence must answer the question. No preamble, no restating the question.
- If the answer is a single line, that line IS the conclusion — stop there.

### 2. Separate fact from guess (사실/추정 분리)
Never blend verified facts with inference. Label them.
- **사실**: directly observed (read the file, ran the command, saw the log).
- **추정**: inference, assumption, or memory not yet verified.
- If something is a guess, say so. Do not present inference as fact.

### 3. Name the recommendation (추천안 명시)
When you present options, mark the recommended one and say why in one line.
- Put the recommended option first and tag it `(추천)`.
- Always include the trade-off of the alternative — never a bare list.

### 4. Reference the source docs (참고 문서 경로)
When the answer draws on a spec or verification document, list the paths under a **참고 문서** section at the very bottom.
- Trigger: a Spec / VERIFY_CHECKLIST / design doc was actually read or produced.
- Also append this block when a skill hands back a command (e.g. `/Qgs`, `/Qplan`) — list what the user should read before running it.

```
참고 문서
- /spec/order/order-api-v1.md
- /docs/eai/material-sync.md
```

---

## Tier 2 — Conditional (fire only when the trigger is met)

Each rule below states its trigger. If the trigger is not met, do NOT apply it — forcing the form on small content hurts readability and wastes tokens.

### 5. Comparison → table
- **Trigger**: comparing **2+ items** across **2+ attributes** (or any item × cost/benefit matrix).
- **Skip when**: it's a single contrast expressible in one sentence ("A is faster but A uses more memory").
- Why the trigger: a 2×1 comparison in a table is overhead, not clarity.

### 6. Cause analysis → tree
- **Trigger**: the cause chain has **2+ levels** (root → intermediate → result).
- **Skip when**: single direct cause — just state it.
- Format:

```
원인
 ├─ 1차 원인
 │   └─ SAP 데이터 미전송
 ├─ 2차 원인
 │   └─ EAI 재처리 실패
 └─ 결과
     └─ HRCS 미반영
```

### 7. Evidence-level conclusion (근거레벨 결론)
- **Trigger**: diagnosis, root-cause, debugging, or any claim the user will act on.
- Attach a confidence stamp + the raw evidence so the user can judge reliability.
- Scale:

| Stars | Meaning |
|---|---|
| ★★★★★ | Directly confirmed (log / reproduced / read the value) |
| ★★★★☆ | Strong indirect evidence (consistent traces, no contradiction) |
| ★★★☆☆ | Reasonable inference from partial data |
| ★★☆☆☆ | Plausible hypothesis, unverified |
| ★☆☆☆☆ | Speculation, flagged as such |

- Format:

```
결론: 사용자가 동일 기사로 이관
근거 수준: ★★★★★ 직접 로그 확인
근거
- P_USER  = A
- P_OPERNR = B
- P_PERNR  = B
```

### 8. Examples as a separate section
- **Trigger**: the explanation needs a concrete example to be clear.
- Order: **설명 → 예시 → 참고**. The example goes in its own section *after* the explanation, never interleaved.
- A "참고" (notes / caveats) section follows the example when there are edge cases.

### 9. Hierarchy for long content
- **Trigger**: 3+ related points or nested structure.
- Use headings, bullets, or the tree form — not a wall of prose.

### 10. Closing summary
- **Trigger**: answer body is **8+ lines** OR covers **2+ distinct topics**.
- **Skip when**: shorter — the conclusion line already serves as the summary.
- Format: 3–5 lines, each a single takeaway. Not a re-explanation.

---

## Anti-patterns (do NOT do)

- ❌ Opening with "좋은 질문입니다" / "~에 대해 설명드리겠습니다" — start with the answer.
- ❌ A table for a one-line contrast.
- ❌ A 5-line summary appended to a 3-line answer.
- ❌ A cause tree for a single direct cause.
- ❌ Presenting an inference without the 사실/추정 label when the user could act on it wrongly.
- ❌ A bare option list with no recommendation.

---

## Self-check (before sending a substantive reply)

Run this silently; it costs nothing:

1. Does the **first sentence** state the conclusion?
2. Is every actionable claim marked **사실** or **추정**?
3. If options exist, is one tagged **(추천)** with a reason?
4. Did any Tier-2 trigger fire, and if so is the form applied? (table / tree / ★ / 참고 문서)
5. If the body is long, is there a 3–5 line summary?

---

## Integration

- **Main session**: referenced from project `CLAUDE.md` and `QE_CONVENTIONS.md`.
- **User-facing agents** (e.g. `Esupervision-orchestrator`, `Ecode-reviewer`, `Edeep-researcher`): link this file in their system prompt so reports stay consistent with the main session.
- **Out of scope**: background executors that only return structured data (`Ecommit-executor`, `Earchive-executor`, etc.) — they emit machine output, not prose.
