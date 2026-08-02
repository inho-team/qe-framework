# LLM Anti-Pattern Gallery

> LLM 코딩 에이전트가 반복적으로 저지르는 실수와 올바른 대안.
> Based on Karpathy's 4 principles + qe-framework defense mapping.

## How to Use

- 코드 리뷰 시 체크리스트로 활용
- `/Qcritical-review`, `/Ecode-reviewer`가 참조하는 기준 문서
- 새 팀원/에이전트 온보딩 자료

---

## Category 1: 과도한 추상화 (Simplicity First 위반)

### 1. Premature Abstraction

**원칙**: Simplicity First
**감지**: 1회 사용 로직에 제네릭 유틸리티 클래스/함수 생성
**qe-framework 방어**: `/Qcritical-review`, SIVS Verify 단계

**Bad:**
```typescript
// "사용자 이름 표시" 요청에 범용 포맷터 생성
class TextFormatter {
  private strategy: FormatStrategy;
  constructor(strategy: FormatStrategy) {
    this.strategy = strategy;
  }
  format(text: string): string {
    return this.strategy.apply(text);
  }
}

interface FormatStrategy {
  apply(text: string): string;
}

class CapitalizeStrategy implements FormatStrategy {
  apply(text: string) { return text.charAt(0).toUpperCase() + text.slice(1); }
}

const name = new TextFormatter(new CapitalizeStrategy()).format(user.name);
```

**Good:**
```typescript
const displayName = user.name.charAt(0).toUpperCase() + user.name.slice(1);
```

**Why**: 3줄이면 될 일에 인터페이스, 클래스, 전략 패턴을 도입할 이유가 없다. 두 번째 포맷 전략이 필요해지면 그때 추상화한다.

---

### 2. Config Explosion

**원칙**: Simplicity First
**감지**: 간단한 기능에 환경변수, 설정 파일, feature flag 추가
**qe-framework 방어**: `/Qcritical-review` adversarial and visual-review modes

**Bad:**
```typescript
// "타임아웃 5초로 설정" 요청에
const config = {
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  retryCount: parseInt(process.env.RETRY_COUNT || '3'),
  retryDelay: parseInt(process.env.RETRY_DELAY || '1000'),
  enableCircuitBreaker: process.env.CIRCUIT_BREAKER === 'true',
};

// config.json도 생성
// .env.example도 생성
// README에 환경변수 테이블도 추가
```

**Good:**
```typescript
const TIMEOUT_MS = 5000;

const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
```

**Why**: 요청은 "타임아웃 5초"였다. retry, circuit breaker, 환경변수는 요청하지 않았다. 상수 하나면 충분하다.

---

### 3. Over-Engineering Error Handling

**원칙**: Simplicity First
**감지**: 발생 불가능한 시나리오에 방어 코드 + fallback 추가
**qe-framework 방어**: `/Ecode-reviewer`, SIVS Verify 단계

**Bad:**
```typescript
function getUser(id: string): User {
  if (!id) throw new Error('ID is required');
  if (typeof id !== 'string') throw new TypeError('ID must be string');
  if (id.length > 255) throw new RangeError('ID too long');
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid ID format');

  const user = db.users.get(id);
  if (!user) {
    logger.warn(`User not found: ${id}`);
    metrics.increment('user.not_found');
    throw new NotFoundError(`User ${id} not found`);
  }
  return user;
}
```

**Good:**
```typescript
function getUser(id: string): User {
  const user = db.users.get(id);
  if (!user) throw new NotFoundError(`User ${id} not found`);
  return user;
}
```

**Why**: `id`는 이미 라우터에서 검증된 내부 값이다. 내부 코드의 타입을 재검증할 필요 없다. 시스템 경계(API 입력)에서만 검증하고, 내부는 프레임워크를 신뢰한다.

---

## Category 2: 범위 이탈 (Surgical Changes 위반)

### 4. Drive-by Refactoring

**원칙**: Surgical Changes
**감지**: 버그 수정/기능 추가 PR에 관련 없는 코드 정리 포함
**qe-framework 방어**: `pre-tool-use.mjs` 스킬 오버라이드 가드, `/Qcritical-review`

**Bad:**
```typescript
// "getUserById 에서 null 반환 시 크래시 수정" 요청에
// 버그 수정 외에 추가로:
- const data = results.data;  // 변수명 변경
+ const userData = results.data;

- function processUser(u: any) {  // 타입 추가
+ function processUser(u: User): ProcessedUser {

- // TODO: refactor later  // 주석 제거
+ /** Processes raw user data into display format */  // JSDoc 추가
```

**Good:**
```typescript
// 크래시 원인인 null 체크만 추가
const user = getUserById(id);
if (!user) return res.status(404).json({ error: 'User not found' });
```

**Why**: 버그 수정과 리팩토링을 같은 커밋에 섞으면 리뷰어가 버그 수정을 검증하기 어렵다. 변수명이 마음에 안 들면 별도 커밋으로 한다.

---

### 5. Unsolicited Features

**원칙**: Surgical Changes
**감지**: 요청하지 않은 기능을 "있으면 좋을 것 같아서" 추가
**qe-framework 방어**: `Qplan` 요구사항 명확화와 SIVS Spec 단계 (스펙에 없으면 구현 안 함)

**Bad:**
```typescript
// "파일 업로드 API 만들어줘" 요청에
app.post('/upload', async (req, res) => {
  const file = req.file;
  await storage.save(file);

  // 요청 안 한 것들:
  await sendSlackNotification(`New file: ${file.name}`);
  await updateSearchIndex(file);
  logger.info({ event: 'file_upload', size: file.size, type: file.type });
  metrics.histogram('upload_size', file.size);
  await generateThumbnail(file);

  res.json({ id: file.id });
});
```

**Good:**
```typescript
app.post('/upload', async (req, res) => {
  const file = req.file;
  await storage.save(file);
  res.json({ id: file.id });
});
```

**Why**: Slack 알림, 검색 인덱싱, 썸네일 생성은 별도 요구사항이다. "파일 업로드 API"는 저장 + 응답이 전부다. 필요하면 사용자가 요청한다.

---

### 6. Comment/Docstring Pollution

**원칙**: Surgical Changes
**감지**: 수정하지 않은 코드에 JSDoc/docstring 일괄 추가
**qe-framework 방어**: `post-tool-use.mjs` 코멘트 커버리지 체크 (변경 코드만 검사)

**Bad:**
```typescript
// "calculateTotal 함수 버그 수정" 요청에
// 파일의 모든 함수에 JSDoc 추가:

/** Validates the input parameters */
function validateInput(input: Input): boolean { ... }  // 안 건드림

/** Formats the output for display */
function formatOutput(data: Data): string { ... }  // 안 건드림

/** Calculates the total amount including tax */
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);  // 이것만 수정
}
```

**Good:**
```typescript
function validateInput(input: Input): boolean { ... }  // 그대로

function formatOutput(data: Data): string { ... }  // 그대로

function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
```

**Why**: 변경하지 않은 코드에 주석을 추가하면 git blame이 오염된다. 문서화가 필요하면 별도 작업으로 요청한다.

---

## Category 3: 무음 가정 (Think Before Coding 위반)

### 7. Silent Assumption

**원칙**: Think Before Coding
**감지**: 요구사항에 없는 기술 결정을 확인 없이 진행
**qe-framework 방어**: `Qplan` 정보 수집과 내부 Spec 단계

**Bad:**
```typescript
// "사용자 데이터 저장 기능" 요청에 확인 없이:
import { MongoClient } from 'mongodb';  // DB를 MongoDB로 결정

const client = new MongoClient(process.env.MONGO_URI!);
const db = client.db('myapp');

// bcrypt로 비밀번호 해싱도 추가 (요청 안 함)
import bcrypt from 'bcrypt';
const hashedPassword = await bcrypt.hash(password, 12);

// Redis 세션 스토어도 추가 (요청 안 함)
import Redis from 'ioredis';
```

**Good:**
```typescript
// 먼저 질문:
// 1. 어떤 DB를 사용하나요? (이미 프로젝트에 있는 건?)
// 2. 비밀번호 해싱이 필요한가요?
// 3. 세션 관리 방식은?

// 답변 후 해당 스택으로만 구현
```

**Why**: MongoDB vs PostgreSQL, bcrypt vs argon2 — 이런 결정은 프로젝트 컨텍스트에 따라 달라진다. 확인 없이 결정하면 나중에 전체 재작업이 필요하다.

---

### 8. Phantom Requirements

**원칙**: Think Before Coding
**감지**: 명시되지 않은 요구사항을 스스로 발명하여 구현
**qe-framework 방어**: SIVS Spec→Implement 게이트 (스펙에 없으면 구현 차단), `/Qcritical-review`

**Bad:**
```typescript
// "로그인 폼 만들어줘" 요청에
function LoginForm() {
  return (
    <form>
      <input name="email" />
      <input name="password" type="password" />
      <button type="submit">Login</button>

      {/* 요청 안 한 것들: */}
      <div className="divider">or</div>
      <GoogleLoginButton />
      <GithubLoginButton />
      <Link href="/forgot-password">Forgot password?</Link>
      <Link href="/signup">Create account</Link>
      <LanguageSwitcher />
    </form>
  );
}
```

**Good:**
```typescript
function LoginForm() {
  return (
    <form>
      <input name="email" />
      <input name="password" type="password" />
      <button type="submit">Login</button>
    </form>
  );
}
```

**Why**: "로그인 폼"은 이메일 + 비밀번호 + 제출 버튼이다. OAuth, 비밀번호 찾기, 회원가입 링크, 다국어 전환은 각각 별도 요구사항이다. 필요하면 사용자가 추가를 요청한다.

---

## References

- [Karpathy's LLM coding pitfalls](https://x.com/kaborya/status/1913375560984903993) — 4 principles
- [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) — EXAMPLES.md format
- qe-framework `QE_CONVENTIONS.md` — PSE Chain, SIVS loop
- `/Qcritical-review` — adversarial review skill
- `Qplan` — ambiguity detection, planning, and internal spec control
