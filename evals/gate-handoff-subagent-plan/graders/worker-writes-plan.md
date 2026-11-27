---
type: tool_order
before: Agent
after:
  tool: Write
  input_match: '"file_path"\s*:\s*"[^"]*[\\/]plan\.md"'
---

plan.md는 작업자를 띄운 뒤에 처음 쓰였다(위임하지 않거나 계획 문서가 나오지 않으면 실패). 조율 창이 위임 뒤에
직접 쓰거나 Edit로 고치는 경우는 coordinator-no-plan-write가 잡는다.
