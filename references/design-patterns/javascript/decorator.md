# Decorator

## 목적

기존 함수를 호출하는 래퍼에서 계측이나 기록을 더한다. 래퍼는 원래 함수에 호출을 위임하고 호출자가 의존하는 입력·반환·오류 계약을 보존한다.

## 사용처

서로 다른 함수에 실행 시간 측정이나 호출 기록을 반복해서 붙일 때 사용한다. 추가 동작이 함수 한 곳의 도메인 로직이라면 함수 안에 쓰는 편이 흐름을 파악하기 쉽다.

## 장단점

원래 구현을 건드리지 않고 부가 기능을 조합할 수 있다. 여러 래퍼를 겹치면 실행 순서가 달라지고, 메서드의 `this`나 반환 형태를 잘못 전달하면 호출부가 깨진다. 계측이나 캐시를 추가하면 실행 비용과 메모리 사용량도 늘 수 있다.

## 구현 방식

동적 `this`를 전달하려면 일반 함수 형태의 래퍼에서 `Reflect.apply(original, this, args)`를 사용한다. 고정된 객체에 묶을 때는 명시적으로 바인딩한다. 동기 함수의 계약을 유지하는 래퍼는 동기로 값을 반환하고 예외도 그대로 전파한다. 비동기 전용 래퍼에서 완료 후 작업을 하려면 `try`에서 `await`하고 `finally`에서 정리한다. 후처리에서 또 오류가 나면 원래 결과를 덮을 수 있으므로 운영에서 계측 실패를 다루는 방식을 정한다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다.

### 사례 1 — 일반 함수의 소요 시간 기록하기

동기 포맷터에 시간 측정을 추가한다. 시계와 기록 함수는 테스트에서 교체할 수 있게 인자로 받는다.

```javascript
import assert from 'node:assert/strict'

function measureSync(fn, { now, record }) {
  return function (...args) {
    const started = now()
    try {
      return Reflect.apply(fn, this, args)
    } finally {
      record(now() - started)
    }
  }
}

const times = [10, 17]
const samples = []
const label = measureSync((name, count) => name + ': ' + count, {
  now: () => times.shift(),
  record: elapsed => samples.push(elapsed),
})

assert.equal(label('apples', 3), 'apples: 3')
assert.deepEqual(samples, [7])
```

포맷터의 동기 반환값과 7이라는 가상 측정값을 확인한다. 실제 경과 시간을 재려면 밀리초 단위 단조 시계인 `performance.now()`를 호출하는 함수를 주입한다.

### 사례 2 — 메서드를 호출한 객체 유지하기

전송기의 메서드를 감싸 이름을 기록한다. 같은 래퍼를 사용하는 객체가 각자의 설정으로 실행되어야 한다.

```javascript
import assert from 'node:assert/strict'

function logCall(method, note) {
  return function (...args) {
    note(args[0])
    return Reflect.apply(method, this, args)
  }
}

const events = []
const send = logCall(function (text) {
  return this.prefix + text
}, message => events.push(message))

const primary = { prefix: 'primary: ', send }
const backup = { prefix: 'backup: ', send }

assert.equal(primary.send('ready'), 'primary: ready')
assert.equal(backup.send('retry'), 'backup: retry')
assert.deepEqual(events, ['ready', 'retry'])
```

래퍼가 어떤 객체에 붙어 호출됐는지에 따라 접두사가 달라진다. 두 입력이 기록되고 반환값에 각 객체의 접두사가 반영되는지 확인한다.

### 사례 3 — 비동기 반환값과 원래 거부 유지하기

요청이 성공하거나 실패한 뒤 후처리를 한 번 실행하고, 호출자에게 원래 값과 오류를 전달한다. 이 예시의 후처리 함수는 예외를 던지지 않는다고 가정한다.

```javascript
import assert from 'node:assert/strict'

function onCompletion(task, complete) {
  return async function (...args) {
    try {
      return await Reflect.apply(task, this, args)
    } finally {
      complete()
    }
  }
}

const remoteError = new Error('Offline')
const item = { id: 4 }
let completions = 0
const load = onCompletion(async available => {
  if (!available) throw remoteError
  return item
}, () => { completions += 1 })

assert.equal(await load(true), item)
await assert.rejects(load(false), error => error === remoteError)
assert.equal(completions, 2)
```

호출자는 이행 값의 객체와 거부 사유를 그대로 받는다. 두 경로에서 후처리가 각 한 번 실행되는지 확인한다. 래퍼가 만든 Promise의 동일성은 계약에 포함하지 않는다.

## 관련 문서

- [Middleware](middleware.md)는 여러 단계의 순서와 다음 단계 실행 여부까지 제어한다.
- [Adapter](adapter.md)는 원래 함수의 호출 형식을 내부 계약에 맞춰 변환한다.
