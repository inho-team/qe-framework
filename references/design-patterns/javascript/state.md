# State

## 목적

현재 상태와 입력이 다음 상태를 어떻게 결정하는지 한곳에 표현한다. 호출부마다 불리언 플래그를 조합하는 대신 전이 함수가 허용되는 동작과 결과를 관리한다.

## 사용처

업로드나 네트워크 요청이 시작, 완료, 실패, 취소, 재시도에 걸쳐 이어질 때 사용한다. 관심 있는 조건이 독립적인 참·거짓 하나라면 불리언 값으로 표현해도 충분하다.

## 장단점

불가능한 조합과 예외적인 전이를 찾기 쉽고, 상태 함수에 이벤트를 넣어 경계를 테스트할 수 있다. 상태와 이벤트의 세분 정도에 따라 구현이 길어지고 전이마다 부수 효과를 관리해야 한다. JavaScript에서는 임의의 문자열이 들어올 수 있으므로 상태 값의 출처와 유효성도 관리한다.

## 구현 방식

상태 값과 이벤트 종류를 정하고 전이 함수에서 허용되는 조합을 표현한다. 상태 계산과 실제 비동기 작업을 분리하고, 거절할 입력과 무시할 늦은 이벤트를 호출 계약에서 정한다. 동시 실행이나 취소가 있다면 시도마다 구분할 값이나 토큰을 유지한다. 전이가 복잡해지면 프로젝트에서 채택한 상태 기계의 계층·이벤트 모델을 활용한다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다. 외부 작업은 메모리에서 재현한다.

### 사례 1 — 업로드의 허용 전이 정하기

업로드는 대기 중인 상태에서 시작할 수 있다. 진행 중에는 완료하거나 취소할 수 있다. 이 예시에서는 잘못된 이벤트를 호출자에게 오류로 알린다.

```javascript
import assert from 'node:assert/strict'

const transitions = new Map([
  ['idle', new Map([['start', 'uploading']])],
  ['uploading', new Map([['success', 'done'], ['cancel', 'cancelled']])],
])

function transition(status, event) {
  const nextStatus = transitions.get(status)?.get(event)
  if (nextStatus === undefined) {
    throw new RangeError(status + ' cannot accept ' + event)
  }

  return nextStatus
}

const uploading = transition('idle', 'start')
assert.equal(uploading, 'uploading')
assert.equal(transition(uploading, 'success'), 'done')
assert.equal(transition(uploading, 'cancel'), 'cancelled')
assert.throws(() => transition('cancelled', 'success'), RangeError)
```

두 종착 상태로 가는 경로를 검사한다. 취소가 확정된 업로드는 완료 전이를 받아들이지 않는지도 확인한다.

### 사례 2 — 재시도 가능한 요청 상태 표현하기

일시 장애에서만 재시도를 허용한다. 같은 상태에서 진행 요청을 중복으로 받거나 영구 장애 뒤 다시 시도하면 거부한다.

```javascript
import assert from 'node:assert/strict'

function transition(state, event) {
  const { status, attempt } = state
  if (status === 'idle' && event.type === 'start') {
    return { status: 'pending', attempt: 1 }
  }
  if (status === 'pending' && event.type === 'failure') {
    return { status: event.transient ? 'retryable' : 'failed', attempt }
  }
  if (status === 'retryable' && event.type === 'retry') {
    return { status: 'pending', attempt: attempt + 1 }
  }
  if (status === 'pending' && event.type === 'success') {
    return { status: 'done', attempt }
  }

  throw new RangeError(status + ' cannot accept ' + event.type)
}

const initial = { status: 'idle', attempt: 0 }
const first = transition(initial, { type: 'start' })
const stopped = transition(first, { type: 'failure', transient: true })
const retry = transition(stopped, { type: 'retry' })

assert.deepEqual(retry, { status: 'pending', attempt: 2 })
assert.deepEqual(transition(retry, { type: 'success' }), {
  status: 'done',
  attempt: 2,
})
assert.throws(() => transition(retry, { type: 'retry' }), RangeError)

const failed = transition(first, { type: 'failure', transient: false })
assert.equal(failed.status, 'failed')
assert.throws(() => transition(failed, { type: 'retry' }), RangeError)
```

일시 장애 뒤에 두 번째 시도를 시작해 완료할 수 있다. 진행 중인 시도를 중복 실행하려 하거나 영구 장애를 재시도하려 할 때 오류가 나는지도 확인한다. 실제 시스템에서는 전송 계층에서 실패를 분류하고 쓰기 요청에는 재시도 중복을 피할 식별자를 사용한다.

### 사례 3 — 이전 요청의 늦은 결과 무시하기

검색 화면에는 가장 최근 요청의 결과만 반영한다. 메모리 대역으로 완료 순서를 제어한다.

```javascript
import assert from 'node:assert/strict'

function createSearch(fetchResults) {
  let current = null
  let state = { status: 'idle' }

  return {
    getState() {
      return state
    },
    async run(query) {
      const token = Symbol()
      current = token
      state = { status: 'loading', query }
      try {
        const results = await fetchResults(query)
        if (current === token) state = { status: 'ready', query, results }
      } catch (error) {
        if (current === token) state = { status: 'failed', query, error }
      }
    },
  }
}

const pending = new Map()
const search = createSearch(query => new Promise((resolve, reject) => {
  pending.set(query, { resolve, reject })
}))

const oldRun = search.run('p')
const newRun = search.run('pen')
pending.get('pen').resolve(['pen'])
await newRun
pending.get('p').resolve(['paper'])
await oldRun
assert.deepEqual(search.getState(), {
  status: 'ready',
  query: 'pen',
  results: ['pen'],
})

const olderRun = search.run('o')
const latestRun = search.run('order')
pending.get('o').reject(new Error('Stale request'))
await olderRun
assert.deepEqual(search.getState(), { status: 'loading', query: 'order' })
pending.get('order').resolve([])
await latestRun
assert.deepEqual(search.getState(), { status: 'ready', query: 'order', results: [] })
```

새 요청이 완료된 뒤 들어온 이전 성공과, 새 요청이 진행 중일 때 들어온 이전 실패가 상태를 덮어쓰지 않는지 각각 확인한다. 이 함수는 오류를 상태에 기록한다. 이전 작업의 실행 자체를 중단하려면 공급자가 쓰는 취소 신호도 연결한다.

## 관련 문서

- [Strategy](strategy.md)는 호출할 정책을 교체할 때 사용한다.
- [Observer](observer.md)는 확정된 상태 변경을 다른 객체에 알릴 수 있다.
- [Adapter](adapter.md)는 하위 API의 취소와 완료 규약을 내부 계약으로 옮긴다.
