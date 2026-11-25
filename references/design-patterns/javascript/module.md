# Module

## 목적

모듈이 공개할 이름을 정하고 구현 세부를 모듈 내부에 숨긴다. 호출자는 `export`에 의존하므로 내부 자료 구조나 보조 함수를 바꾸더라도 공개 계약을 유지하면 호출부를 수정할 필요가 없다.

## 사용처

여러 파일에서 같은 기능을 쓰거나 진입점 하나에 공개 API를 모을 때 사용한다. 함수 하나를 파일 내부에서만 쓰는 경우에는 파일 안에 선언해 두는 것으로 충분하다.

## 장단점

공개 범위를 좁히면 변경 영향을 찾기 쉽다. 같은 ESM 인스턴스를 가져오는 호출자는 모듈 수준의 가변 상태를 공유하므로 요청 간 데이터가 섞이거나 테스트 결과가 실행 순서에 의존할 수 있다. 가져오는 순간 부수 효과가 일어나면 초기화 순서에도 민감해진다.

## 구현 방식

Node.js에서 프로젝트의 패키지 설정이나 확장자에 맞춰 모듈 형식을 정한다. ESM에서는 필요한 이름만 공개하고 Node.js의 상대 `import`에는 확장자를 붙인다. 환경 변수처럼 실행 위치에 의존하는 설정은 진입점에서 한 번 읽고 검증한 다음 인자로 넘긴다. 요청별 자료는 호출 범위에 두고, 의도적으로 공유하는 캐시는 소유자와 수명을 명시한다.

## 예시

### 사례 1 — ESM 진입점에 공개 API 모으기

문자열 포맷터를 가져오는 호출자에게 공개 이름 하나를 제공한다. Node.js 20 이상에서 주석에 적힌 이름대로 같은 디렉터리에 세 파일을 저장하고 `node --test public.test.mjs`를 실행한다.

```javascript
// format.mjs
function normalize(value) {
  return value.trim().replace(/\s+/g, ' ')
}

export function formatLabel(value) {
  return normalize(value).toUpperCase()
}

// index.mjs
export { formatLabel } from './format.mjs'

// public.test.mjs
import assert from 'node:assert/strict'
import * as api from './index.mjs'

assert.deepEqual(Object.keys(api), ['formatLabel'])
assert.equal(api.formatLabel(' packed   order '), 'PACKED ORDER')
```

공개 이름 목록과 변환 결과를 검사하므로 내부 보조 함수의 공개 여부도 확인할 수 있다.

### 사례 2 — 모듈 경계를 넘어 설정 전달하기

페이지 크기를 진입점에서 정하고 기능 모듈에 넘긴다. Node.js 20 이상에서 같은 디렉터리에 두 파일을 저장하고 `node --test page.test.mjs`를 실행한다.

```javascript
// page.mjs
export function firstPage(items, { size }) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Page size must be a positive integer')
  }

  return items.slice(0, size)
}

// page.test.mjs
import assert from 'node:assert/strict'
import { firstPage } from './page.mjs'

const items = ['pencil', 'paper', 'eraser']
assert.deepEqual(firstPage(items, { size: 1 }), ['pencil'])
assert.deepEqual(firstPage(items, { size: 2 }), ['pencil', 'paper'])
assert.throws(() => firstPage(items, { size: 0 }), RangeError)
```

같은 모듈 인스턴스에서 크기를 바꿔 바로 호출할 수 있다. 두 결과와 잘못된 크기에서의 오류를 확인한다.

### 사례 3 — 요청과 테스트 사이에서 상태 격리하기

한 요청에 같은 항목이 나오면 중복을 제거하되, 다른 요청에서 같은 값이 나오면 그대로 처리한다. Node.js 20 이상에서 같은 디렉터리에 두 파일을 저장하고 `node --test recipients.test.mjs`를 실행한다.

```javascript
// recipients.mjs
export function selectRecipients(addresses) {
  const seen = new Set()

  return addresses.filter(address => {
    if (seen.has(address)) return false
    seen.add(address)
    return true
  })
}

// recipients.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectRecipients } from './recipients.mjs'

test('deduplicates within one request', () => {
  assert.deepEqual(selectRecipients(['a', 'a', 'b']), ['a', 'b'])
})

test('starts a fresh set for the next request', () => {
  assert.deepEqual(selectRecipients(['a']), ['a'])
  assert.deepEqual(selectRecipients(['a']), ['a'])
})
```

각 호출에서 새 `Set`을 만들므로 한 요청 안에서는 중복을 지우고 이후 요청에서 같은 값을 처리할 수 있다. 두 테스트가 같은 모듈 인스턴스를 사용해 이 동작을 검사한다.

## 관련 문서

- [Factory](factory.md)는 함수가 반환한 객체마다 상태를 유지해야 할 때 클로저의 수명을 인스턴스에 맞춘다.
- [Facade](facade.md)는 공개 API에 여러 호출을 묶는 도메인 작업을 제공한다.
- [Node.js ECMAScript modules](https://nodejs.org/api/esm.html)
