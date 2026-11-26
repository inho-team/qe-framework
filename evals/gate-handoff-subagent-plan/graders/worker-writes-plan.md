---
type: tool_order
before: Agent
after:
  tool: Write
  input_match: '"file_path"\s*:\s*"[^"]*[\\/]plan\.md"'
---

plan.md는 작업자를 띄운 뒤에 처음 쓰였다. 조율하는 창이 위임 전에 직접 쓰거나, 위임하지 않고 쓰면 통과하지 못한다.
