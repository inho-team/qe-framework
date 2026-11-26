---
type: regex
target: trace
pattern: '^(?=.*"parent_tool_use_id":null)(?=.*"name":"(?:Write|Edit)","input":\{(?:"replace_all":(?:true|false),)?"file_path":"[^"]*[\\/](?:implement-)?plan\.md").*$'
flags: m
match: not_contains
---

조율하는 창은 plan.md·implement-plan.md를 Write로도 Edit로도 건드리지 않았다. trace의 한 줄은 한 이벤트이고,
조율 창의 도구 호출은 `parent_tool_use_id`가 null이다. 작업자의 호출은 그 Agent 호출의 id를 가지므로 여기 걸리지 않는다.
위임 전후·작업자 반환 뒤 어느 때든 조율 창이 계획 문서를 쓰거나 고치면 실패한다.
