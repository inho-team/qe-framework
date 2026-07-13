# Contract Layer — AI 리팩토링 의도 보호

**Contract Layer**는 비즈니스 로직의 의도를 "계약"으로 고정해 AI 리팩토링 중 우발적인 훼손을 막는 머신 검증 레이어입니다.

---

## 1. 개요 (Overview)

### 문제: "Vibe Coding"

AI 코딩 도구는 코드를 읽고 수정할 때 **의도를 무의식적으로 훼손**할 수 있습니다:

- 성능 최적화 중 비즈니스 규칙을 깨뜨림
- 리팩토링 중 엣지 케이스 처리가 사라짐
- 모델이 바뀌면 같은 코드에서 다른 결정이 나옴

### 솔루션: 구조화된 계약 + 검증

**Contract Layer**는 다음을 조합합니다:

1. **구조화된 마크다운 계약**: 함수의 시그니처, 목적, 제약사항, 불변량(invariants)을 코드로 작성 불가능한 명시적 형식으로 정의
2. **3-해시 기반 verdict 캐시**: contract/implementation/test 3자의 내용 해시로 이전 판정을 재사용 → 토큰 비용 최소화
3. **LLM judge**: "이 구현이 계약을 만족하는가?" 판정 (판정성 확보)
4. **3층 방어**:
   - 1층: 대화 기반 승인 게이트 (`/Qcontract approve`)
   - 2층: `.lock` 파일 해시 추적 (계약 변경 감지)
   - 3층: git pre-commit hook (의도하지 않은 drift 차단)

### Phase 구성

| Phase | 기능 | 상태 |
|-------|-----|------|
| **Phase 1** | 템플릿 + 파서 + 샘플 계약 2개 | ✅ 완료 |
| **Phase 2** | `/Qcontract` 스킬 + 승인 메커니즘 | ✅ 완료 |
| **Phase 3** | `/Qverify-contract` + 판정 캐시 | ✅ 완료 |
| **Phase 4** | 사용자 문서 + Qexecute -verify 통합 + pre-commit hook | ✅ 현재 |

---

## 2. 워크플로 (Workflow)

### 4단계 사용자 흐름

#### **1단계: 계약 작성**

```bash
/Qcontract create user-registration
```

`.qe/contracts/pending/user-registration.md`에 draft 생성:

```markdown
# User Registration Contract

## Signature
function registerUser(email: string, password: string): Promise<User>;

## Purpose
새로운 사용자를 등록하고 초기 인증 상태를 설정합니다.

## Constraints
- 이메일은 RFC 5322 형식 검증 필수
- 비밀번호는 8자 이상, 대/소문자+숫자+특수문자 필수
- 중복 이메일 거부

## Invariants
- 반환되는 User.id는 고유함
- User.verified는 항상 false로 초기화
- 비밀번호는 데이터베이스에 해시된 형태로만 저장

## Error Modes
```ts
type RegisterUserError =
  | ConflictError  // 이미 등록된 이메일
  | ValidationError  // 잘못된 이메일/비밀번호 형식
  | DatabaseError;
```
```

사용자가 템플릿의 6개 섹션을 채웁니다.

#### **2단계: 승격 + 승인**

```bash
# pending/에서 active/로 이동
mv .qe/contracts/pending/user-registration.md \
   .qe/contracts/active/user-registration.md

# 승인 → .lock에 해시 기록
/Qcontract approve user-registration --reason "Product spec v1.2.3 정의대로"
```

`.qe/contracts/.lock`에 기록:
```json
{
  "user-registration": {
    "approvedHash": "sha256:abc123...",
    "timestamp": "2026-04-22T10:30:00Z",
    "reason": "Product spec v1.2.3 정의대로"
  }
}
```

#### **3단계: 검증**

```bash
# 단일 계약 검증
/Qverify-contract user-registration

# 모든 활성 계약 검증
/Qverify-contract --all
```

contract/impl/test 3자를 LLM이 대조하고 verdict 반환:

```
✅ PASS  user-registration
  └─ Signature 일치, Constraints 충족, Invariants 검증됨

❌ FAIL  user-registration
  └─ Issue #1: validateEmail() 로직이 RFC 5322 미준수 (빈 로컬 부분 수용)
  └─ Issue #2: 해시된 비밀번호가 평문으로 노출됨 (로그 참조)
```

verdict는 `.qe/contracts/.verdicts/user-registration.json`에 캐시됨:
```json
{
  "contractHash": "sha256:def456...",
  "implHash": "sha256:ghi789...",
  "testHash": "sha256:jkl012...",
  "verdict": "FAIL",
  "issues": [...],
  "timestamp": "2026-04-22T10:35:00Z"
}
```

해시가 변하지 않으면 **재판정 안 함** (토큰 비용 무료).

#### **4단계: 통합**

```bash
/Qexecute -verify
```

Step 4.10에서 자동 호출:
```
Step 4.10: Run /Qverify-contract --all
  ✅ PASS  user-registration
  ✅ PASS  payment-processing
  ❌ FAIL  email-notification (새 의존성 추가 후 미검증)
```

또는 git pre-commit hook (선택):
```bash
# .git/hooks/pre-commit로 설치하면
git commit -m "fix: validate email more strictly"
  → pre-commit-contract-check.mjs 실행
  → 계약 파일 변경 감지
  → .lock 무결성 체크
  → 3층 방어 통과 못 하면 커밋 거부
```

### 실제 예시

`.qe/contracts/active/sivs-enforcer.md` 샘플을 참고하세요:

```bash
cat .qe/contracts/active/sivs-enforcer.md
```

6개 섹션의 실제 작성 방식과 복잡한 flow 다이어그램(mermaid)을 볼 수 있습니다.

---

## 3. FAQ (자주 묻는 질문)

### Q1: 모든 함수에 계약을 붙여야 하나요?

**A**: 아니요. **Opt-in 원칙**입니다.

- `.qe/contracts/active/{name}.md` 파일이 존재하는 함수만 검증됩니다.
- 핵심 비즈니스 로직(사용자 인증, 결제, 보안)에만 선택적으로 적용하세요.
- 유틸리티 함수나 자주 바뀌는 구현은 계약 불필요합니다.

### Q2: AI가 계약을 몰래 고칠 수 없나요?

**A**: 3층 방어 중 하나라도 우회하기 어렵습니다.

1. **대화 승인** (`/Qcontract approve`): 사용자 명시적 동의 필수
2. **`.lock` 해시 추적**: 계약 변경 감지 (`git diff`에 visible)
3. **pre-commit hook**: 계약 drift 차단 (push 전 강제 검증)

AI가 `.md` 파일을 수정해도 해시가 바뀌고, `.lock`과 불일치하면 검증 단계에서 즉시 실패합니다.

### Q3: LLM judge 비용은 얼마인가요?

**A**: **무료에 가깝습니다.**

- 3-해시 기반 verdict 캐시: contract/impl/test 파일 해시가 안 바뀌면 재판정 안 함
- 파일이 변하지 않으면 **토큰 비용 0**
- 비용은 "변경된 것만큼"에 수렴

예: 10개 계약 중 2개만 코드 변경 → 2개만 판정 (8개는 캐시 재사용)

### Q4: LLM judge 판정이 들쭉날쭉하면?

**A**: **결정성 보장**됩니다.

- 같은 3-해시 값에서는 캐시된 이전 판정을 **항상** 재사용
- LLM이 "이번에는 다르게 생각"해도 캐시가 덮어씀
- 해시가 바뀔 때만 새로 판정

판정을 바꾸려면 의도적으로 코드/테스트/계약을 수정해야 합니다.

### Q5: 기존 프로젝트에 어떻게 도입하나요?

**A**: Migration 섹션을 참고하세요.

단계별로 첫 계약을 만들고, 점진적으로 확대할 수 있습니다.

---

## 4. Migration (기존 프로젝트 적용)

### Step 1: 디렉토리 확인

```bash
# .qe/contracts/ 디렉토리가 있는지 확인
ls -la .qe/contracts/

# 없으면 생성
mkdir -p .qe/contracts/{active,pending,.verdicts}
```

### Step 2: 첫 계약 draft 생성

```bash
# 핵심 비즈니스 함수 선택 (예: 결제 처리)
/Qcontract create payment-processing
```

draft가 `pending/payment-processing.md`에 생성됩니다.

### Step 3: 템플릿 채우기

`pending/payment-processing.md`를 열어 6개 섹션을 작성:

1. **Signature**: 함수 타입 정의 (TypeScript 코드 블록)
2. **Purpose**: "이 함수는 ___을 한다"
3. **Constraints**: "입력값은 ___을 만족해야 한다"
4. **Flow** (선택): mermaid 다이어그램 또는 텍스트 설명
5. **Invariants**: "함수 후 항상 ___이 참이어야 한다"
6. **Error Modes**: 발생 가능한 에러 타입 (TypeScript `type` 정의)

### Step 4: 승격 + 승인

```bash
# 자신감 있으면 바로 active로 이동
mv .qe/contracts/pending/payment-processing.md \
   .qe/contracts/active/payment-processing.md

# 승인 (대화형 게이트)
/Qcontract approve payment-processing \
  --reason "결제 시스템 spec v2.1 기준"
```

### Step 5: 현재 상태 검증

```bash
# 계약이 현재 impl/test와 일치하는지 확인
/Qverify-contract payment-processing
```

차이 있으면:
- 계약 수정 → `/Qcontract approve` 다시
- 코드 수정 → `/Qverify-contract` 재실행

### Step 6: git hook 설치 (선택)

```bash
# .qe/contracts/git hook를 .git/hooks/pre-commit으로 복사
cp hooks/git/pre-commit-contract-check.mjs .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

이후 계약 파일 변경 시 커밋 전 검증:

```bash
git commit -m "refactor: simplify payment logic"
# → pre-commit hook 실행
# → contract 파일 변경 감지
# → .lock 무결성 확인
# → 통과 못 하면 거부
```

### Step 7: /Qexecute -verify 통합 (자동)

`/Qexecute -verify` 실행 시 Step 4.10에서 자동으로 `/Qverify-contract --all` 호출됩니다.

```bash
/Qexecute -verify
  ...
  Step 4.10: Verify all contracts
    ✅ PASS  payment-processing
    ✅ PASS  user-registration
```

모든 계약이 green이어야 task 완료로 표시됩니다.

### 다음 계약 추가

```bash
# 2번째, 3번째 계약 반복
/Qcontract create order-fulfillment
# ... 6개 섹션 작성 ...
mv .qe/contracts/pending/order-fulfillment.md \
   .qe/contracts/active/order-fulfillment.md
/Qcontract approve order-fulfillment --reason "..."
/Qverify-contract order-fulfillment
```

점진적으로 핵심 함수들을 보호합니다.

---

## 더 배우기

- **Contract 템플릿 상세**: `.qe/contracts/TEMPLATE.md`
- **실제 샘플**: `.qe/contracts/active/sivs-enforcer.md`
- **Qcontract 스킬**: `/Qhelp Qcontract`
- **Qverify-contract 스킬**: `/Qhelp Qverify-contract`
- **Phase 3 설계**: `.qe/planning/features/contract-layer/phases/3/`

---

**시작하기**: `/Qcontract create <function-name>` → 6개 섹션 작성 → `/Qcontract approve` → 보호됨! 🛡️
