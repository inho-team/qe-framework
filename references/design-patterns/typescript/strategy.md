# Strategy

## 목적

공통 호출 흐름과 변경 가능한 정책을 분리한다. 소비자는 정책에 같은 방식으로 입력을 넘기고, 정책은 자체 계산 규칙을 맡는다.

## 사용처

가격 할인이나 정렬 순서처럼 같은 종류의 작업을 여러 방식으로 처리할 때 쓴다. 정책이 하나뿐이고 재사용이나 교체가 필요하지 않다면 계산을 직접 호출해도 된다.

## 장단점

함수 타입으로 작은 정책을 교체할 수 있고 테스트에서 정책을 지정해 결과를 재현할 수 있다. 정책을 고르는 경로가 늘어나면 등록 목록과 설정 검증이 필요해지고, 정책의 동기·비동기 계약이 다르면 공통 소비자의 처리 방식도 달라진다.

## 구현 방식

입력과 출력의 관계가 드러나도록 함수 타입이나 인터페이스를 선언한다. 결과가 입력 타입에 의존하면 제네릭으로 관계를 표현한다. 키 선택과 외부 입력 검증은 정책 실행 전에 처리하고 동기 결과인지 `Promise`인지 호출 계약으로 명시한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 함수 타입으로 할인 정책 교체

같은 주문 합계에 정가 정책과 회원 할인 정책을 각각 적용한다. 금액 단위는 센트다.

```typescript
type Discount = (subtotalCents: number) => number;

const regularPrice: Discount = () => 0;
const memberDiscount: Discount = subtotal => Math.floor(subtotal * 0.1);

function total(subtotalCents: number, discount: Discount): number {
  return Math.max(0, subtotalCents - discount(subtotalCents));
}

console.log(total(1_250, regularPrice));
console.log(total(1_250, memberDiscount));
```

실행하면 정가 `1250`과 회원 할인 적용 금액 `1125`가 차례로 출력된다.

### 사례 2 — 선택 정책이 입력 요소의 타입 보존

어떤 목록이든 같은 정책으로 첫 항목이나 마지막 항목을 선택한다. 선택 결과에서 원래 요소의 필드에 접근한다.

```typescript
type Select = <Item>(items: readonly Item[]) => Item | undefined;

const first: Select = items => items[0];
const last: Select = items => items.at(-1);

function pick<Item>(items: readonly Item[], select: Select): Item | undefined {
  return select(items);
}

console.log(pick([{ title: 'first' }, { title: 'last' }], last)?.title);
console.log(pick([10, 20], first)?.toFixed(1));
console.log(pick<number>([], first));
```

실행 결과는 `last`, `10.0`, `undefined`다. 각각 객체, 숫자, 빈 배열에서 정책을 적용한다.

### 사례 3 — 미등록 정책과 비동기 정책 거절

설정은 외부 문자열을 전달한다. 등록된 동기 정책만 고르고 나머지는 미등록으로 처리한다.

```typescript
type Normalize = (input: string) => string;

const policies = new Map<string, Normalize>([
  ['trim', input => input.trim()],
  ['upper', input => input.toUpperCase()]
]);

function normalize(policy: string, input: string): string | undefined {
  return policies.get(policy)?.(input);
}

function verifyTypes(): void {
  // @ts-expect-error 비동기 정책은 문자열 대신 Promise를 반환한다.
  policies.set('async', async input => input);
}

console.log(normalize('trim', ' Ada '));
console.log(normalize('missing', ' Ada '));
```

실행하면 `Ada`와 `undefined`가 출력된다. 주석을 제거하면 비동기 함수의 등록이 타입 검사에서 거절된다.

## 관련 문서

정책을 고르는 과정에서 객체도 생성해야 한다면 [Factory](factory.md)를 참고한다. 업무 로직에 외부 자원 구현을 연결하려면 [의존성 주입](dependency-injection.md)을 참고한다.
