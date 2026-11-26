---
type: tool_order
before:
  tool: Skill
  input_match: '"skill"\s*:\s*"(?:[\w-]+:)?Qplan"'
after: Agent
---

조율하는 창이 작업자를 띄우기 전에 Qplan을 불렀다. 작업자의 Qplan 호출은 Agent 호출 뒤에 기록되므로 여기서 통과하지 못한다.
