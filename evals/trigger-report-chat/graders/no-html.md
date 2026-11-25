---
type: regex
pattern: '<html|<!doctype'
flags: i
match: not_contains
target: last_message
---

최종 답변에 HTML 문서가 들어 있지 않다.
