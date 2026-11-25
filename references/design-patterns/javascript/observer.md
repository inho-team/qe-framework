# Observer

## 목적

이벤트를 만든 객체와 이벤트를 처리하는 여러 소비자의 결합을 낮춘다. 발행자는 이벤트 종류와 전달할 값을 정하고 소비자는 관심 있는 이벤트에 등록한다.

## 사용처

같은 상태 변경으로 UI, 집계, 로깅이 각각 갱신되거나, 기존 프레임워크의 구독 기능에 수명주기를 연결할 때 사용한다. 결과를 받는 곳이 하나이고 호출 관계가 고정되어 있다면 직접 호출이 흐름을 추적하기 쉽다.

## 장단점

발행자를 수정하지 않고 수신자를 늘릴 수 있다. 실행 순서와 중복 등록 규약은 API에 따라 다르며, 구독 수명이 관리되지 않으면 콜백과 그 콜백이 참조하는 값이 남을 수 있다. 수신자가 던진 예외나 반환한 Promise가 어떻게 처리되는지도 확인해야 한다.

## 구현 방식

브라우저에는 DOM `EventTarget`, Node.js에는 전역 `EventTarget`과 `node:events`의 `EventEmitter`가 있다. 같은 종류·함수·캡처 설정으로 등록한 `EventTarget`의 리스너는 중복되지 않는다. `EventEmitter.on`은 같은 함수를 여러 번 등록할 수 있고 일반 리스너는 등록 순서대로 동기 호출된다. 구독한 코드가 실제 콜백을 보관해 해제하거나, 지원할 경우 `AbortSignal`을 수명과 함께 사용한다. Node.js의 `EventTarget`과 `EventEmitter`는 오류 전달 방식이 다르므로 한 API의 예외 처리를 다른 API에 그대로 적용할 수 없다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다.

### 사례 1 — EventTarget에서 변경을 구독하기

온라인 상태 변경을 구독한 화면이 현재 값을 읽고, 화면 수명이 끝나면 구독을 해제한다. 상태 객체와 구독에는 브라우저와 Node.js가 제공하는 `EventTarget`, `Event`, `AbortController`를 사용한다. 아래 검증 코드는 Node.js에서 실행한다.

```javascript
import assert from 'node:assert/strict'

class ConnectionState extends EventTarget {
  #online = false

  get online() {
    return this.#online
  }

  setOnline(online) {
    if (online === this.#online) return

    this.#online = online
    this.dispatchEvent(new Event('change'))
  }
}

const state = new ConnectionState()
const lifetime = new AbortController()
const rendered = []
state.addEventListener('change', () => rendered.push(state.online), {
  signal: lifetime.signal,
})

state.setOnline(true)
state.setOnline(true)
lifetime.abort()
state.setOnline(false)
assert.deepEqual(rendered, [true])
assert.equal(state.online, false)
```

실제 상태 변경 한 번만 화면에 전달된다. 해제 이후에도 상태는 바뀌지만 구독 함수는 더는 호출되지 않는지 확인한다.

### 사례 2 — EventEmitter에 소비자 둘 연결하기

출고 이벤트를 받는 집계 함수와 감사 로그 함수를 연결한다. 이 사례에서는 Node.js의 내장 `node:events` 모듈이 필요하다.

```javascript
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const shipments = new EventEmitter()
const trace = []

shipments.on('shipped', ({ count }) => trace.push(['metrics', count]))
shipments.on('shipped', ({ id }) => trace.push(['audit', id]))
shipments.emit('shipped', { id: 's3', count: 2 })

assert.deepEqual(trace, [['metrics', 2], ['audit', 's3']])
```

두 소비자가 같은 출고를 서로 다른 용도로 처리한다. `emit` 직후 두 기록이 등록 순서로 남았는지 확인한다.

### 사례 3 — 리스너 해제와 오류 이벤트 확인하기

같은 리스너를 두 번 붙인 뒤 한 번 해제한다. Node.js `EventEmitter`에서 일반 리스너의 해제와 특별한 `'error'` 이벤트를 별도로 검사한다.

```javascript
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const feed = new EventEmitter()
const received = []
const receive = message => received.push(message)
feed.on('data', receive)
feed.on('data', receive)
feed.off('data', receive)

feed.emit('data', 'first')
feed.off('data', receive)
feed.emit('data', 'second')
assert.deepEqual(received, ['first'])

const outage = new Error('Feed unavailable')
const errors = []
const handleError = error => errors.push(error)
feed.on('error', handleError)
feed.emit('error', outage)
assert.deepEqual(errors, [outage])

feed.off('error', handleError)
assert.throws(() => feed.emit('error', outage), error => error === outage)
```

`off` 한 번으로 등록 한 건이 사라지고, 같은 함수를 한 번 더 해제하면 호출이 없어진다. `'error'` 리스너가 있으면 오류 객체를 전달받으며 리스너가 없으면 `emit`이 동기적으로 예외를 던지는지 확인한다.

## 관련 문서

- [State](state.md)는 상태 변경이 일어날 조건을 관리한다. 변경이 확정된 뒤 구독자에게 이벤트를 보낼 수 있다.
- [DOM Standard — EventTarget](https://dom.spec.whatwg.org/#interface-eventtarget)
- [Node.js Events](https://nodejs.org/api/events.html)
