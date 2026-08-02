---
skill: Qplan
prompt: "인증 모듈을 리팩터링하는 계획을 세워줘"
must_include:
  - "Plan:"
must_not_include:
  - "Qgenerate-spec"
  - "Qexecute"
  - "Next Command"
  - "I'll start writing the code now"
rubric: |
  PASS if the response (1) derives a plan slug, (2) presents a phased roadmap or a
  scale-appropriate plan, and (3) continues PSE internally without exposing internal commands — WITHOUT
  writing or modifying any source code. FAIL if it jumps straight to implementation or
  exposes Qgenerate-spec/Qexecute as a user-facing next command.
---

Guards the core Qplan contract: PLAN only, never code, and private internal PSE choreography.
Regression target — internal commands leak to the user, or planner starts implementing.
