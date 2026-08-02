# Naming Rules -- Execution-Level Checklist

> Referenced by: all agents
> Method naming quality principles: see "Method Naming Quality — 7 Principles" section below

Complements PRINCIPLES.md "Code Quality Principles" (KISS). This file provides naming conventions.

## Variables

- Use descriptive nouns: `userProfile`, `orderTotal`, `connectionPool`
- Avoid single-letter names except in short lambdas or loop indices
- Avoid generic names: `data`, `info`, `temp`, `result` (add context: `userData`, `orderInfo`)

## Functions / Methods

- Use verb + noun: `fetchUser`, `calculateTotal`, `validateInput`
- Event handlers: `onSubmit`, `handleClick`, `onUserLogin`
- Converters: `toJSON`, `fromString`, `parseConfig`

## Booleans

- Prefix with: `is`, `has`, `can`, `should`, `was`
- Examples: `isActive`, `hasPermission`, `canEdit`, `shouldRetry`
- Avoid negated names: use `isEnabled` not `isNotDisabled`

## Constants

- `UPPER_SNAKE_CASE`: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT_MS`, `API_BASE_URL`
- Group related constants in an enum or object

## Files

- Match the primary export: `UserService.ts` exports `UserService`
- Use kebab-case for non-class files: `user-utils.ts`, `api-client.ts`
- Test files: `{source-file}.test.ts` or `{source-file}.spec.ts`

## QE-Specific Naming

- Skills: `Q` prefix + established action name: `Qplan`, `Qcommit`, `Qexecute`
- Agents: `E` prefix + PascalCase role: `Ecommit-executor`, `Ecode-reviewer`
- Core files: descriptive UPPER_SNAKE_CASE: `PRINCIPLES.md`, `INTENT_GATE.md`
- Hook scripts: kebab-case: `pre-tool-use.mjs`, `session-start.mjs`

---

## Method Naming Quality — 7 Principles

메서드 이름 품질을 구체화한 7개 원칙. 원칙 1~5는 단일 메서드 레벨(동사/축약/부작용), 원칙 6~7은 레이어 경계 레벨(누수/관점)을 다룬다. 레이어 구분이 없는 단일 레이어 프로젝트는 원칙 1~5만, 레이어드 아키텍처(DDD / Hexagonal / Clean)에선 원칙 1~7 전부 적용.

### 원칙 1. 축약 금지 (No abbreviations)

도메인 관용 축약(`Db`, `If`, `Cfg`, `Req`, `Rsp`, `Tmp`, `Usr`, `Proc`, `Gen`, `Rpt`, `Ds`)도 쓰지 않는다. 전체 단어로 쓴다.

**Why:** `loadIntoDb()`, `generateIfKey()` 같은 이름은 작성자 머릿속 축약을 읽는 사람이 복원해야 한다. "If"가 조건문인지 Interface인지 구분할 수 없어 인지 부담이 크다. 메서드명은 주석보다 많이 읽히므로 글자 2~3자 아끼는 비용보다 해독 부담이 압도적으로 크다.

**How to apply:** 메서드명 작성 시 축약을 한 번이라도 쓰면 **왜 풀어쓰지 않았는지 스스로 설명해본다.** 설명할 수 없으면 풀어쓴다. 예외: `id`, `url`, `api`, `io`, `db`(클래스명 내에서 해당 분야 관례로 정착한 경우만) 등 **업계 표준 initialism**만 허용.

**예외 — 레거시 일관성:** 도메인 관용 축약이 이미 코드베이스 전반에 깔려 있는 레거시 프로젝트에서는 일관성이 우선한다 (새 메서드만 풀어쓰면 오히려 혼란). 이 경우 신규 축약을 추가하지 말고 기존 패턴을 따른다.

| Don't | Do |
|-------|-----|
| `loadIntoDb()` | `loadIntoDatabase()` |
| `generateIfKey()` | `generateInterfaceKey()` |
| `parseCfgFile()` | `parseConfigFile()` |
| `deleteTmp()` | `deleteTemporaryFile()` |

### 원칙 2. 동사-효과 일치 (Verb matches actual effect)

메서드 이름의 주동사가 **실제 수행하는 부작용 전부**를 포괄해야 한다. 내부에서 DELETE + INSERT를 한다면 "load"가 아니라 "replace"여야 한다.

**Why:** `loadIntoDb`로 명명된 메서드가 실제로는 기존 데이터를 전부 지우고 다시 넣는다면, 호출자는 이름만 보고 **추가**로 오해한다. 이는 실제 프로덕션 사고의 흔한 원인. 이름이 동작을 숨기는 순간 그 메서드는 거짓말을 하는 것.

**How to apply:** 메서드 본문을 보고 주요 상태 변화(CREATE/READ/UPDATE/DELETE, 외부 호출, 예외 발생, 상태 전이)를 나열한 뒤, **가장 파괴적인 동작**을 동사로 채택한다. `loadIntoDb`가 실제로 DELETE+INSERT면 `replaceRecords`; append만 하면 `appendRecords`. 이름을 지을 때 "이 메서드가 뭘 하지?"가 아니라 **"이 메서드가 뭘 파괴하지?"**를 먼저 묻는다.

| Don't | Do |
|-------|-----|
| `loadIntoDb()` (실제: DELETE + INSERT) | `replaceMonthlyRecords()` |
| `flushGroup()` (실제: 버퍼에 append, 조건부 DB flush) | `appendGroupToBuffers()` |
| `updateUser()` (실제: upsert) | `upsertUser()` |
| `saveOrder()` (실제: 외부 API 호출도 함) | `saveOrderAndNotify()` |

### 원칙 3. 부작용·폴백 명시 (Surface side effects and fallbacks)

조용히 삼키는 예외, 기본값 폴백, null 반환 같은 **암묵적 부작용**을 이름의 접미사로 노출한다.

**Why:** `resolveCharset(name)`이 잘못된 이름을 받으면 조용히 EUC-KR로 폴백하는데 이름은 이를 전혀 알리지 않는다. 호출자는 "맞는 charset이 왔겠지"라고 가정하고 진행하다가 기본값이 원하는 동작이 아닐 때 디버그가 어려워진다. 이름이 부작용을 공개하면 호출자가 방어적으로 선택할 수 있다.

**How to apply:** 다음 접미사 관례를 쓴다:
- `~OrDefault` / `~OrElse(X)` — 실패 시 기본값 반환
- `~OrThrow` — 실패 시 예외 던짐 (옵셔널 반환과 구분할 때)
- `~Quietly` / `~Silently` — 실패해도 로그만 남기고 계속
- `~IfPresent` — 없으면 no-op
- `~AndLog` / `~Logged` — 경로에 로깅 부작용 있음

| Don't | Do |
|-------|-----|
| `resolveCharset()` (폴백 포함) | `resolveCharsetOrDefault()` |
| `safeDeleteLocal()` ("safe"가 뭔 뜻?) | `deleteTempFileQuietly()` |
| `getUser()` (없으면 null) | `findUser()` 또는 `getUserOrNull()` |
| `parseDate()` (실패 시 null) | `tryParseDate()` 또는 `parseDateOrNull()` |

### 원칙 4. 일반 동사 회피 (Avoid generic verbs alone)

`process`, `handle`, `do`, `add`, `manage`, `execute`, `run`, `perform` 같은 동사를 **단독으로** 쓰지 않는다. 반드시 목적어와 결합한다.

**Why:** `GroupAccumulator.add()`는 "뭘 add하는지"를 클래스명에서 추측해야 한다. `ProcessService.process(data)`는 호출 스택에서 어떤 process인지 완전히 소실된다. 일반 동사는 IDE의 "Find usages"를 망가뜨리고 코드 리딩 시 의미 파악을 매번 본문 확인으로 강제한다.

**How to apply:** 이 동사 목록을 사용할 때는 **반드시 구체 명사를 붙인다**. 예: `add` → `addRecord`, `addChild`, `addObserver`. 클래스 컨텍스트로 명사를 자명하게 추론 가능해도 명시한다 (스택 트레이스/IDE 검색 가치를 위해).

**유예 예외:** 표준 인터페이스 구현(`Iterator.next`, `Runnable.run`, `Consumer.accept`, `Function.apply`)은 예외. JDK/표준 라이브러리 계약이다.

| Don't | Do |
|-------|-----|
| `accumulator.add(rec)` | `accumulator.addRecord(rec)` |
| `handle(event)` | `handleClickEvent(event)` |
| `service.process(data)` | `service.normalizeCustomerData(data)` |
| `manager.do()` | (본질적으로 설계 문제 — 구체 책임으로 분리) |

### 원칙 5. 도메인 용어 우선 (Domain terms over generic scope words)

`local`, `temp`, `item`, `data`, `group`, `thing`, `info`, `value` 같은 범용 단어는 **도메인 명사로 치환**한다.

**Why:** `safeDeleteLocal()`에서 "local"이 뭔지 — localhost 파일? localStorage? 로컬 변수? 알 수 없다. 도메인 명사(`downloadedTempFile`, `orderGroup`, `inspectionRecord`)를 쓰면 **이름만 보고 개념의 위치가 식별**된다. 범용 단어는 "인간 포인터"일 뿐 스스로 가리키는 게 없다.

**How to apply:** 메서드/변수명에 범용 단어가 들어가면, **이 프로젝트의 도메인 용어집에서 대체어를 찾는다**. 대체어가 없다면 그 범용 단어 자체가 더 구체화되어야 할 신호. 파라미터에도 적용: `process(item)` → `process(inspectionRecord)`. 언어별 컨벤션(camelCase in Java/JS, snake_case in Python)은 이 원칙과 상충하지 않는다 — 도메인 명사를 해당 언어 관례대로 포맷하면 된다.

| Don't | Do |
|-------|-----|
| `safeDeleteLocal(file)` | `deleteDownloadedTempFile(file)` |
| `group.toHeader()` | `orderGroup.toInspectionHeader()` |
| `processItem(item)` | `processInspectionRecord(record)` |
| `getData()` | `getCustomerBillingHistory()` |

### 원칙 6. 레이어 어휘 일치 (Layer-appropriate vocabulary)

메서드 이름은 **자신이 속한 레이어의 어휘만 쓴다**. 다른 레이어의 어휘를 끌어오면 경계 누수(leaky abstraction).

**Why:** 서비스 레이어 메서드가 `loadIntoDb()`라고 이름지어지면 "DB"라는 인프라 개념이 호출자에게 노출된다. 호출자는 서비스를 불렀을 뿐인데 내부에 DB가 있다는 사실을 알게 됨 — 추상화가 깨짐. 어댑터를 파일 기반이나 메시지 큐로 바꾸면 이름이 거짓말이 된다. 같은 방향으로, Adapter가 `calculatePriceWithDiscount()` 같은 도메인 정책 어휘를 가지면 인프라가 비즈니스 로직을 침범한 신호.

**How to apply:** 아래 **Appendix A — Layer Vocabulary Matrix**에서 허용/금지 어휘를 확인. 메서드 이름에 금지 어휘가 보이면 두 가지 중 선택:
1. **도메인 어휘로 치환** — `loadIntoDb` → `replaceMonthlySnapshot`
2. **메서드를 올바른 레이어로 이동** — `resolveCharset`은 서비스에 있을 이유가 없음 → 설정 계층 helper로 분리

**예외 — 단일 레이어 프로젝트:** 레이어 구분이 없는 소규모 프로젝트(스크립트, CLI 도구, 간단한 유틸리티)에서는 원칙 6 적용 불가.

| Don't (Service layer에 인프라 누수) | Do |
|-------------------------------------|-----|
| `loadIntoDb()` | `replaceMonthlySnapshot()` |
| `flushGroup()` | `commitGroup()` |
| `safeDeleteLocal()` | `releaseTempWorkspace()` |
| `resolveCharset()` | (설정 계층으로 이동) |

### 원칙 7. 호출자 관점 우선 (Caller perspective > implementation mechanism)

메서드 이름은 **호출자가 알아야 할 WHAT**을 말한다. 내부 구현 mechanism(버퍼, 루프, flush 타이밍, 중간 자료구조)은 이름에 들어가선 안 된다.

**Why:** `flushGroup()`은 구현자 시점의 이름 — 호출자는 "flush"가 뭔지 모르고 알 필요도 없다. 호출자가 아는 것은 "그룹이 확정됐다"는 사실뿐. 이름이 `commitGroup()`이면 호출자 시점에서 이해 가능. mechanism 어휘는 구현을 바꿀 때마다 이름도 바꿔야 한다 — 이름이 구현에 묶이면 리팩터가 어려워진다.

**How to apply:** 메서드 이름을 지을 때 "이 메서드를 호출하는 코드를 **5년 뒤 처음 읽는 사람**이 이름만 보고 이해 가능한가?"를 묻는다. mechanism 어휘(`buffer`, `flush`, `drain`, `iterate`, `loop`, `queue`, `stream`, `batch` 등)가 이름에 있으면 대체로 실패 — WHAT이 아닌 HOW를 말하고 있다.

| Don't (mechanism exposed) | Do (caller intent) |
|---------------------------|--------------------|
| `flushGroup()` | `commitGroup()` |
| `drainBuffer()` | `persistPendingRecords()` |
| `iterateAndUpdate()` | `refreshAllTokens()` |
| `loopUntilReady()` | `waitUntilReady()` |

### 자가 점검 체크리스트 (7개 질문)

메서드 이름 지을 때 속으로 훑는 질문. 하나라도 걸리면 이름을 다시 쓴다.

1. **축약 썼나?** → 풀어써라 (단, `id`, `url`, `api`, `io` 등 표준 initialism 예외)
2. **동사가 실제 동작 전부 덮나?** → 가장 파괴적인 동작을 동사로
3. **폴백·예외·부작용 숨기나?** → 접미사로 드러내라 (`~OrDefault`, `~Quietly`)
4. **`process/handle/add/do`만 썼나?** → 목적어 붙여라
5. **`local/temp/data/item`만 썼나?** → 도메인 명사로 치환
6. **내 레이어에 어울리는 어휘만 썼나?** → Service에 인프라 어휘 금지, Adapter에 도메인 정책 어휘 금지 (Appendix A 참조)
7. **호출자가 알 필요 있는 WHAT만 말하고, HOW는 숨겼나?** → mechanism 어휘(buffer/flush/loop 등) 제거

---

## Appendix A — Layer Vocabulary Matrix

레이어드 아키텍처(DDD, Hexagonal, Clean)에서 각 레이어의 어휘를 분리한다. 원칙 6의 허용/금지 어휘 매트릭스.

| Layer | Allowed vocabulary (examples) | Forbidden vocabulary (examples) |
|-------|-------------------------------|---------------------------------|
| **Application / Service**<br/>(use-case orchestration) | `import`, `reconcile`, `approve`, `process`, `finalize`, `replaceMonthlySnapshot`, `commitOrder`, `releaseWorkspace`, `rejectApplication` | `*Db`, `*Jdbc`, `*Http`, `*Ftp`, `flush`, `buffer`, `local`, `tmp`, `charset`, `fd`, `stream`, `socket` |
| **Domain**<br/>(entity, aggregate, domain service) | `validate`, `calculate`, `isEligible`, `convert`, `apply`, `canExecute`, `isComplete`, `accept`, `reject` | I/O 동사 (`read`, `write`, `send`), persistence (`save`, `fetch`, `load`), transport (`publish`, `dispatch`, `broadcast`) |
| **Port / Adapter**<br/>(infrastructure) | `insert`, `delete`, `fetch`, `open`, `close`, `flush`, `encode`, `decode`, `connect`, `poll`, `read`, `write` | 도메인 정책 어휘 (`approve`, `reconcile`, `calculatePrice`, `validateBusinessRule`, `enforceContract`) |

**누수 감지 휴리스틱:**
- Service 메서드명에 `Db / Jdbc / File / Buffer / Flush / Tmp / Local / Charset / Ftp / Http / Stream` 포함 → 원칙 6 위반 가능성 99%. 이름 치환 또는 메서드를 Adapter로 이동
- Adapter 메서드명에 `approve / reconcile / calculate / validate + 도메인 용어` 포함 → Adapter가 도메인 로직을 침범한 신호. 로직을 도메인 서비스로 분리

---

## 사례 — `ChkcfgImportBatchService` Before/After

실제 Spring Boot 배치 서비스(`kr.co.triphos.business.service.inspection.ChkcfgImportBatchService`) 리뷰에서 도출된 Before/After 매핑. 각 메서드가 어느 원칙을 위반했는지 추적.

| Before | 문제 진단 | After | 적용 원칙 |
|--------|----------|-------|----------|
| `loadIntoDb()` | "Db" 축약(1) + 실제는 DELETE+INSERT인데 "load"가 가림(2) + 서비스에 인프라 어휘 노출(6) + mechanism 누수(7) | `replaceMonthlySnapshot()` | 1, 2, 6, 7 |
| `flushGroup()` | "flush"는 구현 mechanism(버퍼 동작)을 이름에 드러냄(2, 7) + 서비스 레이어에 버퍼 어휘 누수(6) | `commitGroup()` | 2, 6, 7 |
| `generateIfKey()` | "If" = Interface 축약, 해독 불가(1) + `generate`는 일반 동사(4) | `newInterfaceKey()` | 1, 4 |
| `safeDeleteLocal()` | "safe" 모호(3) + "local"이 파일시스템 어휘로 도메인 미지정(5) + 서비스에 인프라 어휘 누수(6) | `releaseTempWorkspace()` | 3, 5, 6 |
| `resolveCharset()` | 서비스 레이어에 charset(인프라 어휘) 직접 노출(6) — **이 메서드가 Service에 있는 것 자체가 잘못** | (설정 계층 `ChkcfgEncodingResolver`로 이동) | 6 |
| `GroupAccumulator.add(rec)` | 일반 동사 `add` 단독 사용(4) | `addRecord(rec)` | 4 |
| `toHeader()` | OK — `to*` 변환 관례는 표준 패턴 | (유지) | — |
| `isHeaderMismatch()` | OK — `is*` 불리언 접두사 Java 표준 | (유지) | — |

6개 리네임 대상 중 4개(`loadIntoDb`, `flushGroup`, `safeDeleteLocal`, `resolveCharset`)가 **원칙 6·7(레이어 누수 / 호출자 관점)에 추가로 걸림**. 기존 5원칙만으로는 이 4개 중 레이어 측면의 문제를 잡지 못한다 — 그래서 6·7이 필요하다.
