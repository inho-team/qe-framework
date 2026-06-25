# QA Council — Role Specs & Tool Boundaries

The council enforces the **bounded-agent** principle: each role gets the *minimum* tools its job
needs. A "super agent" with every tool is an anti-pattern and a FAIL condition.

## Role-by-role

### Planner
- **Goal:** turn the scope into a review-ready Markdown scenario list (no code, no execution).
- **Tools:** Read, Grep, Glob (source ok) + browser (read-only exploration).
- **Backed by:** `Qqa-test-planner` (test docs) or `Qscenario-test` (codified flows).
- **Output:** `scenarios.md` — numbered scenarios with intent, steps, expected result, priority.
- **Gate:** user reviews and approves before any execution.

### Explorer — black-box (new agent: `Eqa-explorer`)
- **Goal:** find bugs the way a hostile user would, with **zero knowledge of the source**.
- **Tools:** Bash (browser CLI only), Write (findings artifact only). **NO Read/Grep/Glob/Edit on
  repo source** — this is what makes it true black-box.
- **Probes:** invalid/oversized/empty input, boundary values, **every interactive control (no dead
  buttons), event handlers (click/change), modal open/close + overlay/`Escape` dismissal, keyboard
  reachability (`Tab`/`Enter`), hover feedback, counter/total state consistency**, auth/permission
  edges, responsive breakpoints (mobile/tablet/desktop), broken-flow recovery, and requested
  guardrail scenarios.
- **Blind spots:** the accessibility tree carries no pixels or motion, so spacing/alignment outliers
  and CSS animations are invisible to Explorer — those belong to the optional **Auditor** role, not
  to source-peeking.
- **Output:** `findings.json` — array of `{title, repro_steps[], severity, screenshot, area}`.
- **Hard rule:** if Explorer needs source to reason, that is a signal the test is white-box — hand
  it to Planner/Generator instead. Explorer never opens repo files.
- **Honest limitation:** in-session, `tools:` excludes file-read tools but Bash could still read
  files. True isolation is enforced only in the CI runner via `--allowedTools` (see
  `github-actions.md`). Instruction-level prohibition applies in all contexts.

### Auditor — visual & a11y, read-only (optional, `+visual` mode)
- **Goal:** cover Explorer's pixel/motion/heuristic blind spots — spacing & alignment outliers,
  layout-shift, contrast, keyboard/focus, `prefers-reduced-motion`, and design-token drift.
- **Tools:** Read source + browser, **read-only**. Never writes or edits source (fixes are
  Generator/Healer's job).
- **Backed by:** `Qvisual-qa` (screenshot baseline diff) + `Qweb-design-guidelines` (Vercel WIG a11y/UX
  heuristics) + `Qdesign-audit` (static font/spacing/color outlier scan).
- **Output:** findings merged into the Explorer findings list, tagged `source: auditor`.
- **First-run caveat:** `Qvisual-qa` needs a baseline image to diff against; the first run captures
  the baseline only (regression value starts on run 2). Report this explicitly.
- **Hard rule:** white-box by design, so it runs in its **own step after Explore** — its source
  knowledge must never leak back into the black-box Explorer, and it must never merge the two roles.

### Generator
- **Goal:** convert an approved/exploratory finding into a deterministic, CLI-runnable regression
  test.
- **Tools:** Read/Write code + browser (for codegen/verification).
- **Backed by:** `Qplaywright-expert` (Page Object Model, fixtures, selector strategy).
- **Output:** `*.spec.ts` under the project's test dir. Prefer role/text/test-id selectors over CSS.

### Healer
- **Goal:** when regression fails, reproduce and propose the minimal patch (selector drift, timing,
  code).
- **Tools:** Read/Write code + browser.
- **Backed by:** `Eqa-orchestrator` (test → review → fix loop, capped at 3 iterations).
- **Hard rule:** proposes patches; never silently merges. Escalation rules per `Eqa-orchestrator`.

### Reporter (new agent: `Eqa-reporter`)
- **Goal:** assemble findings into one structured report and (in PR context) post it as a comment.
- **Tools:** Read (artifacts only), Bash(`gh:*`) for PR comment. **No source edits.**
- **Output:** Markdown report + optional `gh pr comment`. Sections: bugs found, tests added, heals
  applied, guardrail verdicts, merge recommendation (human decides).
- **Hard rule:** never `gh pr merge`. Never push. Comment only.

## Tool-boundary summary

| Role | Read src | Write src | Browser | gh/PR | Enforced by |
|------|:--------:|:---------:|:-------:|:-----:|-------------|
| Planner | ✅ | ❌ | ✅ (ro) | ❌ | skill delegation |
| Explorer | ❌ | ❌ | ✅ | ❌ | `Eqa-explorer` tools + CI allowedTools |
| Auditor (opt) | ✅ | ❌ | ✅ (ro) | ❌ | `Qvisual-qa`+`Qweb-design-guidelines`+`Qdesign-audit` |
| Generator | ✅ | ✅ | ✅ | ❌ | `Qplaywright-expert` |
| Healer | ✅ | ✅ | ✅ | ❌ | `Eqa-orchestrator` |
| Reporter | artifacts | ❌ | ❌ | comment | `Eqa-reporter` tools |

## Why bounded agents (source)
The "super agent" pattern fails because a single agent with all tools loses focus, leaks white-box
knowledge into black-box tests, and is hard to govern. Narrow boundaries make each role auditable
and let CI lock tool access per role.
