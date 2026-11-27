---
type: regex
target: trace
pattern: '(?:^|\n)(?=[^\n]*"parent_tool_use_id":\s*null)(?=[^\n]*"name":\s*"(?:Write|Edit)")(?=[^\n]*"file_path":\s*"[^"]*[\\/](?:implement-)?plan\.md")(?![^\n]*"new_string":\s*"- (?:상태|실행 방식): [^"\\]*")'
match: not_contains
---

조율하는 창은 plan.md·implement-plan.md를 Write로도 Edit로도 건드리지 않았다. trace의 한 줄은 한 이벤트이고,
조율 창의 도구 호출은 `parent_tool_use_id`가 null이다. 작업자의 호출은 그 Agent 호출의 id를 가지므로 여기 걸리지 않는다.
위임 전후·작업자 반환 뒤 어느 때든 조율 창이 계획 문서를 쓰거나 고치면 실패한다.
조율자가 적는 진행 기록(새 값이 `- 상태: …`나 `- 실행 방식: …` 한 줄뿐인 Edit)은 실패로 세지 않는다.
키 순서와 공백에 기대지 않도록 조건마다 같은 줄 안의 lookahead로 보고, `.` 대신 `[^\n]`을 써서 본문의
U+2028 같은 문자에서 줄이 끊기지 않게 한다. m 플래그를 쓰지 않는 것도 같은 이유다.
