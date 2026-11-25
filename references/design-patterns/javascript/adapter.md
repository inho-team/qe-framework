# Adapter

## 목적

외부 API의 자료 형식이나 호출 규약을 내부 코드가 사용하는 계약으로 변환한다. 공급자가 바뀌거나 규약이 변경되면 경계에 있는 어댑터에서 차이를 처리한다.

## 사용처

오류 우선 콜백을 쓰는 API를 Promise 기반 흐름에서 호출하거나, 공급자가 제공하는 필드와 단위를 내부 모델에 맞출 때 사용한다. 입력·반환·오류 규약이 이미 같다면 외부 함수를 직접 호출해도 된다.

## 장단점

호출부마다 변환을 구현할 필요가 없고 외부 연동을 대역으로 검증할 수 있다. 그 대신 변환 과정에서 누락되거나 손실되는 정보와 공급자별 예외를 관리해야 한다. Promise 하나로 감싸도 공급자의 작업과 이벤트 구독을 정리하는 책임이 남는다.

## 구현 방식

매핑과 검증을 외부 경계에서 수행한다. 오류 우선 콜백은 오류 인자와 결과 인자를 별도로 다루고, 값의 단위와 선택 값을 명시한다. 취소를 지원하는 API라면 `AbortSignal`의 사전 취소와 실행 중 취소를 모두 처리한다. 공급자가 취소 후에도 콜백을 호출할 수 있다면 완료 여부를 기록하고 종료 경로마다 리스너를 정리한다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다. 공급자의 응답은 메모리에서 재현한다.

### 사례 1 — 오류 우선 콜백을 Promise에 연결하기

기존 SDK는 `(error, value)` 콜백으로 조회 결과를 반환하며, 콜백을 한 번 호출한다고 가정한다.

```javascript
import assert from 'node:assert/strict'

function createLookup(sdk) {
  return id => new Promise((resolve, reject) => {
    sdk.lookup(id, (error, value) => {
      if (error != null) reject(error)
      else resolve(value)
    })
  })
}

const missing = new Error('Record not found')
const lookup = createLookup({
  lookup(id, callback) {
    queueMicrotask(() => {
      if (id === 'p1') callback(null, { id: 'p1' })
      else callback(missing)
    })
  },
})

assert.deepEqual(await lookup('p1'), { id: 'p1' })
await assert.rejects(lookup('p2'), error => error === missing)
```

성공 응답에서는 레코드가 이행 값이 된다. 실패 응답에서는 공급자의 오류 객체가 거부 사유로 전달되는지 확인한다.

### 사례 2 — 공급자 자료를 내부 모델에 맞추기

공급자는 가격을 센트 문자열로 제공한다. 내부 모델은 0 이상인 안전한 정수와 공급자가 보내는 영문 대문자 통화 코드를 사용한다.

```javascript
import assert from 'node:assert/strict'

function fromCatalogItem({ item_code, amount_cents, currency_code }) {
  if (typeof amount_cents !== 'string' || !/^\d+$/.test(amount_cents)) {
    throw new TypeError('Invalid amount')
  }
  const minorUnits = Number(amount_cents)
  if (!Number.isSafeInteger(minorUnits)) throw new RangeError('Amount too large')

  return { sku: item_code, price: { minorUnits, currency: currency_code } }
}

const original = { item_code: 'n1', amount_cents: '1250', currency_code: 'USD' }
assert.deepEqual(fromCatalogItem(original), {
  sku: 'n1',
  price: { minorUnits: 1250, currency: 'USD' },
})
assert.throws(() => fromCatalogItem({ ...original, amount_cents: '12.5' }), TypeError)
assert.throws(() => fromCatalogItem({
  ...original,
  amount_cents: '9007199254740993',
}), RangeError)
```

가격이 내부 모델의 정수 필드로 변환된다. 소수 문자열과 안전하게 표현할 수 없는 큰 정수의 오류도 확인한다. 상품 코드와 통화 코드는 공급자가 검증해 제공한다고 가정한다.

### 사례 3 — 취소와 중복 완료 처리하기

공급자는 조회를 시작하고 작업을 중단하는 함수를 동기적으로 반환한다. 여기서는 취소 함수가 예외를 던지지 않는다고 가정한다. 작업을 취소해도 이미 예약된 콜백이 도착할 수 있다.

```javascript
import assert from 'node:assert/strict'

function readWithSignal(start, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }

    let settled = false
    let cancelRequested = false
    let cancel
    function finish(settle, value) {
      if (settled) return

      settled = true
      signal.removeEventListener('abort', onAbort)
      settle(value)
    }
    function onAbort() {
      cancelRequested = true
      finish(reject, signal.reason)
      cancel?.()
    }

    signal.addEventListener('abort', onAbort, { once: true })
    try {
      cancel = start((error, value) => {
        if (error != null) finish(reject, error)
        else finish(resolve, value)
      })
      if (cancelRequested) cancel()
    } catch (error) {
      finish(reject, error)
    }
  })
}

const cancelled = new AbortController()
let complete
let cancellations = 0
const pending = readWithSignal(callback => {
  complete = callback
  return () => { cancellations += 1 }
}, cancelled.signal)
const rejection = assert.rejects(pending, { name: 'AbortError' })

cancelled.abort()
complete(null, 'late success')
await rejection
assert.equal(cancellations, 1)

const completed = new AbortController()
const value = await readWithSignal(callback => {
  callback(null, 'first')
  callback(new Error('second'))
  return () => { cancellations += 1 }
}, completed.signal)
completed.abort()
assert.equal(value, 'first')
assert.equal(cancellations, 1)

await assert.rejects(readWithSignal(() => {
  throw new Error('Must not start')
}, cancelled.signal), { name: 'AbortError' })

const abortDuringStart = new AbortController()
await assert.rejects(readWithSignal(() => {
  abortDuringStart.abort()
  return () => { cancellations += 1 }
}, abortDuringStart.signal), { name: 'AbortError' })
assert.equal(cancellations, 2)
```

취소가 먼저면 늦은 성공을 무시하고 시작 함수가 돌려준 취소 함수를 한 번 호출한다. 성공이 먼저면 후속 오류와 나중 취소가 결과를 바꾸지 않는다. 미리 취소된 신호에서는 시작 함수가 호출되지 않는지, 시작 도중 취소되면 취소 함수를 받는 즉시 호출하는지도 확인한다.

## 관련 문서

- [Decorator](decorator.md)는 원래 호출 계약을 유지하며 부가 기능을 추가한다.
- [Facade](facade.md)는 여러 하위 호출을 한 업무 단위로 제공한다.
- [Node.js AbortSignal](https://nodejs.org/api/globals.html#class-abortsignal)
