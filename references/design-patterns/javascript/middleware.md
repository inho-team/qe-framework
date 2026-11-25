# Middleware

## 목적

요청 처리에 공통으로 필요한 기능을 순서가 있는 단계로 나눈다. 각 단계가 다음 단계에 위임할지 또는 응답을 확정할지 판단하므로 공통 처리와 업무 핸들러를 분리할 수 있다.

## 사용처

요청 ID, 인증, 검증, 오류 응답이 여러 핸들러에서 같은 순서로 필요할 때 사용한다. 한 핸들러에서 고정된 작업을 순서대로 호출하는 경우에는 함수 호출을 직접 나열해도 흐름이 명확하다.

## 장단점

공통 단계를 여러 요청에 재사용할 수 있고 조기 응답을 단위 테스트하기 쉽다. 단계가 공유 맥락을 수정하므로 잘못된 순서는 누락된 데이터나 접근 검사 우회로 이어질 수 있다. `next()` 호출을 기다리지 않거나 중복 호출하면 응답과 정리 작업의 순서도 달라진다.

## 구현 방식

프레임워크가 있다면 기존 합성 기능과 오류 처리 규칙을 먼저 확인한다. 이 문서에서는 각 단계가 `(context, next)`를 받아 하위 단계의 완료를 기다리거나, 자기 응답을 반환하며 체인을 끝내는 Promise 기반 계약을 사용한다. 로그, 인증, 업무 로직 순서에 의존성이 있다면 합성 지점에서 드러낸다. 실제 응답을 쓰는 책임은 체인의 반환값을 받는 진입점에 둔다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다. 인메모리 맥락을 사용하므로 HTTP 서버가 필요 없다.

### 사례 1 — 요청 단계 합성하기

공통 로그 단계가 업무 핸들러보다 먼저 실행되고, 핸들러가 완료된 뒤 결과를 기록한다.

```javascript
import assert from 'node:assert/strict'

function compose(stages) {
  return context => {
    async function dispatch(index) {
      const stage = stages[index]
      if (!stage) return undefined

      return stage(context, () => dispatch(index + 1))
    }
    return dispatch(0)
  }
}

const trace = []
const handle = compose([
  async (context, next) => {
    trace.push('enter ' + context.path)
    try {
      return await next()
    } finally {
      trace.push('exit ' + context.path)
    }
  },
  async context => {
    trace.push('handler')
    return { status: 200, body: context.path }
  },
])

assert.deepEqual(await handle({ path: '/orders' }), {
  status: 200,
  body: '/orders',
})
assert.deepEqual(trace, ['enter /orders', 'handler', 'exit /orders'])
```

반환된 응답과 단계의 진입·종료 순서를 함께 확인한다.

### 사례 2 — 요청 ID를 부여한 뒤 인증하기

인증이 거부된 요청에도 추적용 ID를 포함한다. ID 생성과 인증 여부는 고정된 값으로 검증한다.

```javascript
import assert from 'node:assert/strict'

async function withRequestId(context, next) {
  context.requestId = 'request-' + context.counter
  const response = await next()
  return { ...response, requestId: context.requestId }
}

async function requireAuth(context, next) {
  if (!context.session?.user) return { status: 401 }
  return next()
}

async function handle(context) {
  return withRequestId(context, () => requireAuth(context, async () => (
    { status: 200, user: context.session.user }
  )))
}

assert.deepEqual(await handle({ counter: 7 }), {
  status: 401,
  requestId: 'request-7',
})
assert.deepEqual(await handle({ counter: 8, session: { user: 'lee' } }), {
  status: 200,
  user: 'lee',
  requestId: 'request-8',
})
```

요청 ID 단계가 인증 단계 바깥에서 응답을 받으므로 401과 200 응답에 모두 ID가 포함된다. 두 요청을 각각 실행해 확인한다.

### 사례 3 — 다음 단계 중복 호출과 조기 응답 처리하기

단계 하나를 실행할 때 같은 `next`에 대한 두 번째 호출을 거부한다. 자체 응답을 반환하는 단계는 업무 핸들러에 위임할 필요가 없다.

```javascript
import assert from 'node:assert/strict'

async function runStage(stage, context, handler) {
  let advanced = false
  return stage(context, async () => {
    if (advanced) throw new Error('next() called more than once')
    advanced = true
    return handler(context)
  })
}

let handlerCalls = 0
const handler = async () => {
  handlerCalls += 1
  return { status: 200 }
}

const stop = async () => ({ status: 429 })
assert.deepEqual(await runStage(stop, {}, handler), { status: 429 })
assert.equal(handlerCalls, 0)

const advanceTwice = async (_context, next) => {
  await next()
  return next()
}
await assert.rejects(runStage(advanceTwice, {}, handler), /more than once/)
assert.equal(handlerCalls, 1)
```

429 경로에서는 업무 핸들러가 실행되지 않는다. 두 번째 경로에서는 핸들러를 한 번 호출한 뒤 중복 호출이 거부된다. 검사는 두 번째 위임을 막으며 첫 번째 호출의 부수 효과는 그대로 남는다.

## 관련 문서

- [Decorator](decorator.md)는 기존 함수 하나를 감싸 계측 등의 동작을 더한다.
- [Facade](facade.md)는 하위 API의 호출 순서를 한 도메인 작업에 담는다.
