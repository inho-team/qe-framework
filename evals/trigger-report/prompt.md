---
description: 'Qreport가 불리는지 — 요청: 분석 내용(인라인) + 방금 분석한 결과를 HTML 보고서로 만들어줘.'
tags: [trigger]
runs: 3
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

아래는 방금 조사한 결과야.

- 로그인 실패율이 11월 20일부터 3%에서 9%로 올랐다.
- 같은 날 배포에서 세션 만료 시간이 30분에서 5분으로 바뀌었다 (`config/session.yml:12`).
- 실패의 대부분은 모바일 앱에서 토큰 갱신 직전에 난다.

이거 HTML 보고서로 만들어줘.
