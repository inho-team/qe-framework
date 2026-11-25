# Facade

## 목적

여러 하위 API 호출을 조율하는 도메인 함수를 제공한다. 호출자는 한 번의 호출로 업무를 요청하고 각 서비스의 호출 순서와 조합은 파사드가 책임진다.

## 사용처

주문 등록과 재고 예약 순서를 여러 호출부에서 반복하거나, 한 화면에 필요한 독립 조회를 한 번에 요청할 때 사용한다. 하위 시스템에서 호출자가 사용할 업무 단위를 이미 제공한다면 해당 API를 직접 호출하는 것으로 충분하다.

## 장단점

호출부가 하위 시스템의 조합을 반복하지 않아도 된다. 파사드가 모든 하위 기능을 일대일로 드러내기 시작하면 설명하고 유지할 호출이 늘어난다. 쓰기 작업이 도중에 실패할 때 남는 변경과, 병렬 호출에서 다른 작업의 취소를 누가 담당할지도 정해야 한다.

## 구현 방식

업무 단위의 함수가 입력·출력과 오류 규약을 정의하고 하위 서비스는 의존성으로 받는다. 선후 의존성이 있는 작업은 순서대로 호출하고 독립 조회는 동시에 요청한다. 실패한 조회 이후 나머지 작업을 멈춰야 한다면 각 하위 API가 수용하는 취소 신호를 전달한다. 재시도 가능한 쓰기는 완료된 단계나 업무 식별자를 반환하고 하위 쓰기가 같은 요청을 중복 적용하지 않도록 설계한다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다. 하위 서비스는 모두 메모리 대역이다.

### 사례 1 — 주문 처리를 한 호출로 묶기

주문을 먼저 만든 뒤 새 주문 ID로 재고를 예약한다.

```javascript
import assert from 'node:assert/strict'

function createCheckout({ orders, stock }) {
  return async function checkout({ sku, count }) {
    const order = await orders.create({ sku, count })
    const reservation = await stock.reserve({ orderId: order.id, sku, count })
    return { orderId: order.id, reservationId: reservation.id }
  }
}

const trace = []
const checkout = createCheckout({
  orders: {
    async create(input) {
      trace.push(['order', input])
      return { id: 'o1' }
    },
  },
  stock: {
    async reserve(input) {
      trace.push(['reserve', input])
      return { id: 'r2' }
    },
  },
})

assert.deepEqual(await checkout({ sku: 'pen', count: 2 }), {
  orderId: 'o1',
  reservationId: 'r2',
})
assert.deepEqual(trace, [
  ['order', { sku: 'pen', count: 2 }],
  ['reserve', { orderId: 'o1', sku: 'pen', count: 2 }],
])
```

호출자는 업무 결과에 필요한 두 ID를 받는다. 호출 내역에서 주문 생성 후 주문 ID가 재고 예약에 전달됐는지 확인한다. 예약에 실패하면 이미 만들어진 주문은 남으므로 후속 처리를 호출 계약에 추가해야 하는 경우에는 사례 3과 같이 처리한다.

### 사례 2 — 여러 조회를 병렬로 조율하기

계정 화면에서 프로필과 읽지 않은 알림 수가 필요하다. 독립적으로 조회하고 외부에서 전달받은 취소 신호를 두 조회에 공유한다.

```javascript
import assert from 'node:assert/strict'

function createDashboard({ profiles, alerts }) {
  return async function loadDashboard(userId, { signal }) {
    const [profile, unreadCount] = await Promise.all([
      profiles.get(userId, { signal }),
      alerts.countUnread(userId, { signal }),
    ])
    return { name: profile.name, unreadCount }
  }
}

const { signal } = new AbortController()
const started = []
let finishProfile
const load = createDashboard({
  profiles: {
    get(id, options) {
      started.push(['profile', id, options.signal])
      return new Promise(resolve => { finishProfile = resolve })
    },
  },
  alerts: {
    async countUnread(id, options) {
      started.push(['alerts', id, options.signal])
      return 3
    },
  },
})

const pending = load('u1', { signal })
assert.deepEqual(started, [['profile', 'u1', signal], ['alerts', 'u1', signal]])
finishProfile({ name: 'Minji' })
assert.deepEqual(await pending, { name: 'Minji', unreadCount: 3 })
```

프로필 조회를 의도적으로 미완료 상태에 두고 두 호출이 시작됐는지 확인한다. 여기서는 신호를 전달했는지 검사한다. `Promise.all` 자체는 한 조회가 실패하더라도 다른 조회를 자동으로 중단하지 않는다.

### 사례 3 — 부분 성공 결과를 반환하고 재시도하기

배송 라벨 발행 뒤 알림을 보내는 과정에서 알림에 실패할 수 있다. 같은 주문을 재시도하면 이미 발급된 라벨을 재사용한다. 예시의 전송 실패는 알림이 전달되기 전에 발생한다.

```javascript
import assert from 'node:assert/strict'

function createDispatch({ labels, notify }) {
  return async function dispatch(orderId) {
    const label = await labels.getOrCreate(orderId)
    try {
      await notify(orderId, label.id)
      return { status: 'complete', labelId: label.id }
    } catch (error) {
      return { status: 'notification-failed', labelId: label.id, error }
    }
  }
}

const issuedByOrder = new Map()
let issued = 0
let attempts = 0
const unavailable = new Error('Notifications offline')
const dispatch = createDispatch({
  labels: {
    async getOrCreate(orderId) {
      if (!issuedByOrder.has(orderId)) {
        issued += 1
        issuedByOrder.set(orderId, { id: 'label-' + issued })
      }
      return issuedByOrder.get(orderId)
    },
  },
  async notify() {
    attempts += 1
    if (attempts === 1) throw unavailable
  },
})

const first = await dispatch('order-8')
assert.deepEqual(first, {
  status: 'notification-failed',
  labelId: 'label-1',
  error: unavailable,
})
assert.deepEqual(await dispatch('order-8'), { status: 'complete', labelId: 'label-1' })
assert.equal(issued, 1)
assert.equal(attempts, 2)
```

첫 결과에 라벨 ID와 알림 오류가 남는다. 같은 주문을 재시도하면 라벨 발행 횟수는 1회, 알림 시도 횟수는 2회다. 라벨 발행 자체가 실패하면 이 함수는 Promise를 거부한다. 운영 환경에서 전달 여부를 확정할 수 없는 오류까지 재시도하려면 알림에도 업무 키를 전달해 중복 전송을 제어한다.

## 관련 문서

- [Adapter](adapter.md)는 자료 형식이나 호출 계약이 다른 하위 시스템을 내부 계약에 맞춘다.
- [Middleware](middleware.md)는 요청을 처리하는 여러 단계에서 다음 단계 호출 여부를 결정한다.
