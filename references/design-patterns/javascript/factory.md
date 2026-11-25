# Factory

## 목적

생성에 필요한 판단과 의존성 조립을 한곳에 모은다. 호출자는 지정된 인터페이스로 객체를 쓰고, 팩토리가 어떤 구현을 만들지와 초기 상태를 어떻게 구성할지 책임진다.

## 사용처

호출마다 독립 상태가 필요하거나, 설정에 따라 구현 선택과 초기화 방식이 달라질 때 사용한다. 호출부에서 상태나 검증 없이 고정된 값만 만들면 객체 리터럴 또는 생성자 호출로 충분하다.

## 장단점

구현 선택과 입력 검증을 공유할 수 있다. 클로저로 상태를 숨기면 쓰기 경로를 제한할 수 있지만 상태를 직접 관찰하기 어려워지므로 공개 동작을 검증해야 한다. 생성한 객체가 연결이나 타이머를 가진다면 종료 책임도 정해야 한다.

## 구현 방식

입력 옵션을 검증한 뒤 조건에 맞는 구현을 고르고, 외부 의존성은 인자로 받는다. 결과 객체의 메서드와 오류 계약을 맞춘다. 팩토리가 매번 생성하는 값과 여러 인스턴스가 공유할 값을 구분하고, 생성에 실패할 수 있는 자원은 검증 후에 확보한다.

## 예시

Node.js 20 이상에서 사례별로 별도 디렉터리를 만들고, 각 코드 블록을 해당 디렉터리의 `example.mjs`에 저장한다. 그 디렉터리에서 `node --test example.mjs`를 실행한다.

### 사례 1 — 클로저로 독립 상태를 가진 객체 만들기

두 장바구니가 같은 상품의 수량을 서로 간섭하지 않고 기록해야 한다.

```javascript
import assert from 'node:assert/strict'

function createCart() {
  const quantities = new Map()

  return {
    add(sku) {
      quantities.set(sku, (quantities.get(sku) ?? 0) + 1)
    },
    quantity(sku) {
      return quantities.get(sku) ?? 0
    },
  }
}

const first = createCart()
const second = createCart()
first.add('pen')
first.add('pen')
second.add('pen')

assert.equal(first.quantity('pen'), 2)
assert.equal(second.quantity('pen'), 1)
assert.equal(second.quantity('paper'), 0)
```

같은 상품에 대해 장바구니별 수량이 각각 2와 1이다. 조회 메서드로 없는 상품의 초깃값도 확인한다.

### 사례 2 — 설정에 맞춰 API 클라이언트 조립하기

공용 API와 사내 API의 인증 헤더가 다르다. 실제 네트워크 요청 대신 경로와 헤더를 돌려주는 전송 함수를 주입한다.

```javascript
import assert from 'node:assert/strict'

function createCatalogClient({ kind, token, send }) {
  const headersFor = new Map([
    ['public', () => ({})],
    ['partner', () => ({ Authorization: 'Bearer ' + token })],
  ])
  const makeHeaders = headersFor.get(kind)
  if (!makeHeaders) throw new RangeError('Unsupported catalog kind')
  if (kind === 'partner' && !token) throw new TypeError('Token required')

  return {
    getItem(id) {
      return send('/items/' + encodeURIComponent(id), makeHeaders())
    },
  }
}

const send = async (path, headers) => ({ path, headers })
const publicClient = createCatalogClient({ kind: 'public', send })
const partnerClient = createCatalogClient({ kind: 'partner', token: 'demo', send })

assert.deepEqual(await publicClient.getItem('a/b'), {
  path: '/items/a%2Fb',
  headers: {},
})
assert.deepEqual(await partnerClient.getItem('a/b'), {
  path: '/items/a%2Fb',
  headers: { Authorization: 'Bearer demo' },
})
```

두 객체의 호출 형식은 같으며 전송 함수가 받는 헤더만 달라진다. 두 호출 모두 ID 안의 슬래시를 인코딩하는지도 확인한다.

### 사례 3 — 종류와 옵션을 검증한 뒤 생성하기

로그 출력 대상은 콘솔 또는 메모리 버퍼다. 지원하지 않는 종류나 쓰기 함수가 빠진 콘솔 설정은 생성 시점에 거부한다.

```javascript
import assert from 'node:assert/strict'

function createLogSink({ kind, writeLine }) {
  if (kind === 'memory') {
    const lines = []
    return { write: line => { lines.push(line) } }
  }
  if (kind === 'console') {
    if (typeof writeLine !== 'function') {
      throw new TypeError('writeLine function required')
    }
    return { write: writeLine }
  }
  throw new RangeError('Unsupported log sink')
}

assert.throws(() => createLogSink({ kind: 'network' }), RangeError)
assert.throws(() => createLogSink({ kind: 'console' }), TypeError)

const captured = []
const sink = createLogSink({ kind: 'console', writeLine: line => captured.push(line) })
sink.write('ready')
assert.deepEqual(captured, ['ready'])
```

잘못된 경우에는 객체를 반환하기 전에 오류가 발생한다. 유효한 설정에서는 준비 메시지가 주입한 출력 함수에 전달되는지 확인한다.

## 관련 문서

- [Module](module.md)은 공개 이름과 파일 경계를 정한다.
- [Strategy](strategy.md)는 만든 객체의 종류 대신 호출 시 적용할 동작을 교체한다.
