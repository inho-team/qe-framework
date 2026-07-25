# VERIFY_CHECKLIST_{{UUID}}.md — 결과 검증
<!-- qe-doc-frontmatter
kind: {{kind}}
uuid: {{UUID}}
plan: {{plan}}
phase: "{{phase}}"
created: "{{created}}"
status: {{status}}
links:
  - "[[.qe/tasks/pending/TASK_REQUEST_{{UUID}}.md]]"
-->

## 검증 기준
{{#each checks}}
- [ ] {{this}}
{{/each}}

## 프레임워크 무결성 체크 (Mandatory)
- [ ] **No Stubs**: `TODO`, `FIXME`, `lorem ipsum` 등의 플레이스홀더가 코드에 남아있지 않은가?
- [ ] **Real Logic**: 함수가 단순히 `null`이나 빈 객체를 반환하지 않고 실제 비즈니스 로직을 수행하는가?
- [ ] **Wiring**: 새로운 컴포넌트나 API가 기존 시스템에 실제로 연결(Import/Route)되어 작동하는가?

## 추가 메모
{{verifyNotes}}

---
> 모든 항목 체크 시 완료. 작업 상태는 `.qe/TASK_LOG.md`와 관련 task artifact에 반영하세요.
