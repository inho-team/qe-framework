---
type: tool_used
tool: Write
input_match: '\.qe(?:[\\/]|\\\\)+tasks'
min: 0
max: 0
arm: both
---

`~/.qe/tasks/` 아래에도 작업 문서(status.json 등)를 만들지 않았다. v11부터 작업 폴더는 여기 생긴다.
eval은 실행마다 임시 HOME을 써서 file_exists로는 볼 수 없으므로, 그 경로로 가는 Write 호출이 없는지 본다.
