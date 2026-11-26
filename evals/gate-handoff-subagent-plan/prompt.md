---
description: '서브에이전트 인계에서 조율하는 창이 Qplan을 부르고 계획 작성은 작업자에게 맡기며, 돌아온 계획의 승인 때 실행 방식을 묻는지'
tags: [gate]
runs: 3
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit]
---

지금은 방금 Qunderstand 인터뷰를 마친 창이야. 의도는 확정했고 ~/.qe/tasks/2026-11-25-todo-due-date/intent.md에(HOME 기준. 이 작업 공간에서는 `../.qe/tasks/2026-11-25-todo-due-date/`) 저장돼 있어. 다음 작업자는 새 세션 말고 서브에이전트로 할게. 추천한 대로 서브에이전트로 진행해.
