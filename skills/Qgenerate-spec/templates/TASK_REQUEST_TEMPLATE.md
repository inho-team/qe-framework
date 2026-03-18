# TASK_REQUEST_{{UUID}}.md — {{작업_제목}}

## 무엇을 원하는가?
{{what}}

## 어떻게 만들 것인가?
{{how}}

## 체크리스트
{{#each steps}}
- [ ] {{this}}
{{/each}}

> **병렬 실행 힌트 (선택 사항):**
> 체크리스트 아이템에 다음 태그를 추가하면 Etask-executor의 Wave 분석에 활용됩니다.
> - `→ output: path/to/file` — 이 아이템이 생성/수정하는 파일 경로
> - `(depends: N)` — 이 아이템이 의존하는 선행 아이템 번호 (1-indexed, 쉼표로 복수 지정 가능)
>
> 예시:
> ```
> - [ ] 데이터 모델 정의 → output: src/model.rs
> - [ ] CLI 파서 구현 → output: src/cli.rs
> - [ ] 모델 테스트 작성 (depends: 1) → output: tests/model_test.rs
> ```
> 태그가 없으면 Etask-executor가 파일 경로를 자동 분석하여 의존성을 추론합니다.

## 의사결정 근거 (선택 사항)
### 선택한 방식
{{chosen_approach}} — {{why_chosen}}

### 고려한 대안
{{#each alternatives}}
- **{{this.name}}**: {{this.description}} — 채택하지 않은 이유: {{this.rejection_reason}}
{{/each}}

### 후속 영향
{{consequences}}

## 참고사항
{{notes}}