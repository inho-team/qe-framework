---
skill: Qplan
prompt: "인증 모듈을 리팩터링하는 계획을 세워줘"
must_include:
  - "Plan:"
  - "Next Command"
must_not_include:
  - "I'll start writing the code now"
rubric: |
  PASS if the response (1) derives a plan slug, (2) presents a phased roadmap or a
  scale-appropriate plan, and (3) ends with a Next Command handoff to /Qgs — WITHOUT
  writing or modifying any source code. FAIL if it jumps straight to implementation or
  omits the Next Command handoff block.
---

Guards the core Qplan contract: PLAN only, never code, and always hand off to /Qgs.
Regression target — handoff block silently dropped, or planner starts implementing.
