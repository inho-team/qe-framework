# Strategy

## 목적

호출 흐름에서 바뀌는 계산이나 판단을 분리한다. 호출부는 입력과 결과의 계약을 유지하고, 어떤 정책을 쓸지는 주입하거나 선택하는 지점에서 결정한다.

## 사용처

같은 입력을 바탕으로 여러 요금제나 배정 정책을 계산하거나, 원격 판정과 로컬 판정을 같은 방식으로 호출할 때 사용한다. 정책이 하나로 고정되어 있고 분기가 짧다면 함수 안에 조건을 두는 것으로 충분하다.

## 장단점

정책마다 독립적으로 검증할 수 있고 호출 흐름을 고치지 않고도 정책을 추가할 수 있다. 이름에 따른 선택 로직과 공통 계약을 관리해야 한다. 특히 동기 결과와 Promise를 섞으면 호출자의 오류 처리 경로가 달라질 수 있다.

## 구현 방식

동기 정책은 입력에서 결과 값으로, 비동기 정책은 입력에서 Promise로 일관된 호출 규약을 정한다. 이름을 받아 정책을 고를 때는 `Map`처럼 허용 목록이 분명한 자료 구조를 쓴다. 알 수 없는 이름과 정책 실행 중 오류를 호출자가 어떻게 식별할지 정한다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다.

### 사례 1 — Map에서 가격 정책 고르기

할인의 입력과 결과는 통화의 최소 단위로 표현한다. 회원 할인에서 최소 단위 미만은 버린다.

```javascript
import assert from 'node:assert/strict'

const discounts = new Map([
  ['standard', () => 0],
  ['member', subtotal => Math.floor(subtotal / 10)],
])

export function total(subtotal, membership) {
  const discount = discounts.get(membership)
  if (!discount) throw new RangeError('Unknown membership')

  return subtotal - discount(subtotal)
}

assert.equal(total(109, 'standard'), 109)
assert.equal(total(109, 'member'), 99)
assert.throws(() => total(109, 'guest'), RangeError)
```

같은 소계에서 일반 가격은 109, 회원 가격은 99다. 회원 할인에 적용하는 버림과 미지원 정책 오류를 함께 확인한다.

### 사례 2 — 같은 계약으로 비동기 배정 정책 주입하기

재고 조회 결과를 바탕으로 창고를 정하는 정책과 테스트용 고정 정책을 동일한 비동기 함수로 받는다. 재고 조회는 메모리 데이터로 대체한다.

```javascript
import assert from 'node:assert/strict'

async function assignOrder(order, chooseDepot) {
  const depot = await chooseDepot(order)
  return { orderId: order.id, depot }
}

function fromStock(lookup) {
  return async ({ sku }) => {
    const availableLocally = await lookup(sku)
    return availableLocally ? 'local' : 'central'
  }
}

const order = { id: 'o1', sku: 'notebook' }
const chooseFromStock = fromStock(async sku => sku === 'notebook')
const chooseForTest = async () => 'test-depot'

assert.deepEqual(await assignOrder(order, chooseFromStock), {
  orderId: 'o1',
  depot: 'local',
})
assert.deepEqual(await assignOrder(order, chooseForTest), {
  orderId: 'o1',
  depot: 'test-depot',
})
```

두 정책 모두 동일한 객체를 받고 창고 이름으로 이행하는 Promise를 반환한다. 배정 함수가 정책을 교체해도 같은 형식으로 결과를 조립하는지 확인한다.

### 사례 3 — 모르는 정책과 Promise 거부 구분하기

외부에서 받은 검수 정책 이름을 조회한다. 이름을 찾을 수 없는 경우와 정책이 의존하는 서비스에서 실패한 경우를 호출자가 구분해야 한다.

```javascript
import assert from 'node:assert/strict'

class UnknownPolicyError extends Error {}

async function review(name, item, policies) {
  const applyPolicy = policies.get(name)
  if (!applyPolicy) throw new UnknownPolicyError(name)

  return applyPolicy(item)
}

const outage = new Error('Review service unavailable')
const policies = new Map([
  ['local', async item => item.ready],
  ['remote', async () => { throw outage }],
])

assert.equal(await review('local', { ready: false }, policies), false)
await assert.rejects(review('missing', {}, policies), UnknownPolicyError)
await assert.rejects(review('remote', {}, policies), error => error === outage)
```

정상적인 검수 결과 `false`는 값으로 전달된다. 미지원 이름의 오류와 원격 정책의 원래 오류가 모두 Promise 거부로 전달되는지 확인한다.

## 관련 문서

- [State](state.md)는 현재 상태에 따라 허용되는 동작과 다음 상태를 정한다.
- [Factory](factory.md)는 호출할 동작과 함께 필요한 객체도 설정에 따라 조립할 수 있다.
