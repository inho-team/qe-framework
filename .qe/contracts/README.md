# Contract Layer — 계약 기반 검증

**Contract Layer**는 AI 리팩토링이 사용자의 비즈니스 로직 의도를 훼손하는 "바이브 코딩" 문제를 방지하기 위해, 함수·모듈의 동작 계약을 고정된 마크다운 형식으로 정의하고, 구현·테스트가 계약과 일치하는지 LLM 판정을 통해 기계적으로 검증하는 레이어입니다. 계약의 변경은 3층 방어(대화 승인 + lock + git hook)를 거쳐야만 가능하며, 사용자의 명시적 동의 없이는 AI가 계약을 수정할 수 없습니다.

---

## 디렉토리 스키마 (Directory Schema)

| 디렉토리 | 설명 |
|---------|------|
| `active/` | 현재 검증 대상인 활성 계약들. `.md` 파일이 여기 존재해야만 해당 함수가 보호됨 (opt-in 원칙) |
| `pending/` | `/Qgs`가 TASK_REQUEST에서 자동 생성한 계약 draft들. 사용자가 검토 후 `active/`로 이동하기 전까지 보류 상태 |
| `.verdicts/` | LLM 판정 결과를 캐싱한 디렉토리. `{name}.json` 파일들이 contract/impl/test 3자 해시와 판정 결과(PASS/FAIL)를 기록. 해시 변화 시에만 재판정 (Phase 3) |
| `.lock` | JSON 파일 — 각 활성 계약의 승인된 해시와 승인 사유를 기록. 계약 변경 시 3층 방어 검증에 사용 (Phase 2) |

---

## Opt-in 원칙 (Opt-In Principle)

**계약은 `active/{name}.md` 파일이 존재할 때만 활성화됩니다.**

- 파일이 없으면 계약이 없는 것이므로, 검증도 일어나지 않습니다.
- 따라서 모든 함수에 계약을 붙일 필요가 없으며, 사용자가 명시적으로 보호하고 싶은 핵심 비즈니스 로직에만 적용합니다.
- 이를 통해 계약 과부하를 방지합니다.

---

## 계약 승격 프로세스 (Promotion Process)

```
[TASK_REQUEST 작성]
        ↓
[/Qgs 실행: 핵심 비즈니스 로직 후보 추출]
        ↓
[pending/{name}.md 자동 draft 생성]
        ↓
[사용자가 pending/ 디렉토리에서 draft 검토]
        ↓
[사용자가 active/ 디렉토리로 이동]
        ↓
[/Qcontract approve: .lock에 해시 + 승인 사유 기록]
        ↓
[계약 보호 시작 — /Qverify-contract가 구현을 검증]
```

**세부 단계:**
1. **Draft 자동 생성**: `/Qgs`가 TASK_REQUEST의 핵심 로직을 식별하고 계약 템플릿 기반으로 `pending/{name}.md` 작성
2. **사용자 검토**: `pending/`의 draft를 읽고 필요시 수정 (또는 `active/`로 즉시 이동)
3. **승격**: draft를 `active/{name}.md`로 이동 (파일 이름만, 내용은 그대로)
4. **승인**: `/Qcontract approve {name}`을 실행하면 `.lock`에 hash + 승인 사유 기록
5. **보호 활성**: 이제 `pending/`의 draft든 external 리팩토링이든, 계약과의 불일치는 `/Qverify-contract`가 감지

---

## Phase 상태 (Phase Status)

- **Phase 1**: 템플릿 확정 + directory schema 문서화 + parser/validator + 샘플 2개 (현재)
  - R001: Contract 템플릿 (Signature / Purpose / Constraints / Flow / Invariants / Error Modes)
  - R002: `.qe/contracts/` 디렉토리 스키마
  - R003: markdown 섹션 파서
  - R004: 핵심 로직 샘플 계약 2개 (dogfooding)

- **Phase 2**: `/Qcontract` 스킬 + 승인 메커니즘 (3층 방어의 1·2층)
  - R005: `/Qcontract create | edit | approve | list` 커맨드
  - R006: `ask_user` 기반 대화형 승인 게이트
  - R007: `.qe/contracts/.lock` 해시 기록 + 승인 사유
  - R008: `/Qgs` TASK_REQUEST 통합 — `pending/` draft 자동 생성

- **Phase 3**: `/Qverify-contract` 스킬 + LLM judge + verdict 캐시
  - R009: LLM judge 에이전트 (contract/impl/tests 3자 대조)
  - R010: `.qe/contracts/.verdicts/` verdict 캐시 (해시 기반 재사용)
  - R011: `/Qverify-contract <name> | --all` 단독 실행
  - R012: 불일치 리포트 포맷 (심각도 분류)

- **Phase 4**: Qexecute -verify 통합 + git pre-commit hook + dogfooding + 사용자 공개
  - R013: `/Qexecute -verify` verify 단계에서 `/Qverify-contract --all` 호출
  - R014: git pre-commit hook — contract.md 수정 시 lock 무결성 체크 (3층 방어의 3층)
  - R015: qe-framework 핵심 skill 5~10개 계약 적용 (dogfooding)
  - R016: 사용자용 README + 예제 프로젝트 + 마이그레이션 가이드

---

## 계약 작성 가이드 (Authoring Guide)

계약 템플릿은 `TEMPLATE.md`에서 확인하세요. 다음 섹션들이 필수입니다:

1. **Signature** (필수, code block `ts`)
   - TypeScript/JavaScript 타입 인터페이스 및 함수 시그니처
   
2. **Purpose** (필수, 자연어)
   - 함수가 무엇을 하는지, 왜 필요한지 명확히 설명
   
3. **Constraints** (필수, 자연어 + 정형화 가능)
   - 입력값의 유효성 규칙, 비즈니스 제약사항
   
4. **Flow** (선택, mermaid 다이어그램)
   - 함수의 실행 흐름과 분기(특히 에러 case)
   
5. **Invariants** (필수, 자연어)
   - 함수 실행 후 항상 만족해야 할 조건
   
6. **Error Modes** (필수, code block `ts`)
   - 발생 가능한 에러 타입과 각각의 조건

섹션 헤더는 정확한 이름과 대소문자를 유지해야 파서가 올바르게 작동합니다.

---

## Decision References

이 Contract Layer는 다음 아키텍처 결정에 근거합니다:

- **D008**: Contract 포맷 — structured markdown + mermaid + code signature 블록
- **D009**: 검증 엔진 — LLM judge + 해시 기반 verdict 캐싱
- **D010**: 계약 변경 3층 방어 (대화 승인 + lock + git hook)
- **D011**: Opt-in 원칙 — `.qe/contracts/active/{name}.md` 파일 존재 여부가 활성 마커

자세한 내용은 `.qe/planning/DECISION_LOG.md`를 참조하세요.
