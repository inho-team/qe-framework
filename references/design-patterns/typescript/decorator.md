# Decorator

## 목적

이미 있는 호출에 계측, 추적, 기록 같은 동작을 추가한다. 래퍼는 원본 실행을 맡기고 호출자가 사용하던 인수, 반환값, 오류 계약을 유지한다.

## 사용처

여러 소비자가 같은 연산을 호출하며 호출마다 부가 동작이 필요할 때 쓴다. 한 호출만 관찰하면 된다면 호출 위치에서 직접 계측하는 편이 읽기 쉽다.

## 장단점

기존 구현의 변경 없이 공통 동작을 적용할 수 있다. 래퍼마다 호출 비용과 부수 효과가 추가되고, 여러 겹으로 감싸면 실행 순서나 오류의 출처를 알아보기 어려워질 수 있다.

## 구현 방식

이 패턴은 함수와 객체만으로 구현할 수 있다. 단일 시그니처는 매개변수 튜플과 반환 타입으로 보존한다. 객체 메서드는 원래 수신 객체를 사용해 호출하고, 비동기 완료를 계측한다면 `await` 이후에 후속 작업을 한다. 제네릭과 오버로드는 공개 시그니처를 유지하는지 따로 확인한다. 계측이 실패할 수 있다면 계측 오류가 원본 오류를 가릴지 계약으로 정한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 계측 후에도 함수 인수와 결과 유지

계산 함수의 호출 횟수를 기록하면서 필수 인수와 숫자 반환 타입을 그대로 사용한다.

```typescript
function countCalls<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  record: () => void
): (...args: Args) => Result {
  return (...args) => {
    record();
    return fn(...args);
  };
}

let calls = 0;
const total = countCalls((price: number, units: number) => price * units, () => { calls++; });

function verifyTypes(): void {
  // @ts-expect-error 수량 인수가 필요하다.
  total(12);
}

console.log(total(12, 3).toFixed(2));
console.log(calls);
```

실행하면 `36.00`과 `1`이 출력된다. 주석을 제거하면 인수가 빠진 호출이 진단된다.

### 사례 2 — 비동기 메서드를 원래 객체에 위임

조회 메서드는 `this`에 저장된 값을 사용한다. 래퍼는 호출과 종료를 기록하고 원래 결과나 거절을 전달한다.

```typescript
class Catalog {
  constructor(private readonly entries: ReadonlyMap<string, string>) {}

  async read(key: string): Promise<string> {
    const value = this.entries.get(key);
    if (value === undefined) throw new Error('missing ' + key);
    return value;
  }
}

function traceRead(catalog: Catalog, events: string[]): (key: string) => Promise<string> {
  return async key => {
    events.push('start ' + key);
    try {
      return await catalog.read(key);
    } finally {
      events.push('end ' + key);
    }
  };
}

async function main(): Promise<void> {
  const events: string[] = [];
  const read = traceRead(new Catalog(new Map([['a', 'Ada']])), events);
  console.log(await read('a'));
  try {
    await read('b');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.log(error.message);
  }
  console.log(events.join(', '));
}

void main();
```

실행하면 `Ada`, `missing b`, `start a, end a, start b, end b`가 차례로 출력된다. 래퍼가 원래 객체의 메서드를 호출하고 실패 시 오류를 그대로 전달한다.

### 사례 3 — 오버로드를 잃은 래퍼 검출

정렬 키는 문자열이면 문자열로, 숫자면 숫자로 돌려준다. 인수와 결과를 하나의 유니온 시그니처로 정의한 래퍼는 각 호출의 타입 관계를 잃는다.

```typescript
function key(value: string): string;
function key(value: number): number;
function key(value: string | number): string | number {
  return typeof value === 'string' ? value.trim() : Math.round(value);
}

function broadKey(value: string | number): string | number {
  return typeof value === 'string' ? key(value) : key(value);
}

function tracedKey(value: string): string;
function tracedKey(value: number): number;
function tracedKey(value: string | number): string | number {
  console.log('key');
  return typeof value === 'string' ? key(value) : key(value);
}

function verifyTypes(): void {
  // @ts-expect-error 문자열 호출의 반환 타입까지 문자열이어야 한다.
  const normalized: string = broadKey(' a ');
}

console.log(tracedKey(' a ').toUpperCase());
console.log(tracedKey(1.7).toFixed(0));
```

실행 결과는 `key`, `A`, `key`, `2`다. 주석을 제거하면 넓은 반환 타입의 대입에서 오류가 난다. 오버로드를 가진 공개 함수는 문자열과 숫자의 메서드를 각각 사용할 수 있다.

## 관련 문서

외부 호출의 계약을 바꾸는 래퍼는 [Adapter](adapter.md)를 참고한다. 정책을 교체하려면 [Strategy](strategy.md)를 참고한다.
