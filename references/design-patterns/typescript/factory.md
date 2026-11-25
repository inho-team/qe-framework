# Factory

## 목적

판별 값에 따라 구현과 초기화 방법을 선택한다. 호출자는 필요한 종류나 옵션을 전달하고 팩토리가 생성 규칙을 맡는다.

## 사용처

출력 대상이나 저장 방식처럼 지원하는 종류가 한정되어 있을 때 쓴다. 고정 구현을 한 곳에서 생성한다면 생성자나 일반 함수의 직접 호출로 충분하다.

## 장단점

생성 분기를 모아 지원 종류가 늘어날 때 확인할 곳을 줄인다. 레지스트리는 키 누락을 컴파일에서 찾을 수 있지만 등록 항목이 많아지면 생성 조건을 따로 살펴야 한다. 반환 타입이 종류마다 다르면 호출자가 판별자에 따른 좁히기를 수행해야 한다.

## 구현 방식

동일한 반환 계약을 가진 생성 함수는 `Record`로 묶고 `satisfies`로 키와 각 생성 함수의 호환성을 확인한다. 반환 계약이 서로 다르면 판별 유니온을 사용한다. 설정의 키는 실행 중 확인하고, 반환된 객체의 해제 책임은 생성 계약에서 정한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다. `satisfies`는 TypeScript 4.9 이상에서 쓸 수 있다.

### 사례 1 — 알림 채널별 생성 결과

화면 알림에는 표시 함수가, 감사 채널에는 이벤트 기록 함수가 필요하다. 팩토리는 채널의 판별자를 결과에 포함한다.

```typescript
type Channel = 'screen' | 'audit';
type Target =
  | { channel: 'screen'; show(message: string): string }
  | { channel: 'audit'; record(event: string): string };

function createTarget(channel: Channel): Target {
  switch (channel) {
    case 'screen': return { channel, show: message => 'show ' + message };
    case 'audit': return { channel, record: event => 'record ' + event };
  }
}

for (const channel of ['screen', 'audit'] as const) {
  const target = createTarget(channel);
  if (target.channel === 'screen') console.log(target.show('ready'));
  else console.log(target.record('ready'));
}
```

컴파일 후 실행하면 `show ready`와 `record ready`가 출력된다. 각 분기에서 생성된 객체의 해당 메서드에 접근한다.

### 사례 2 — 등록 목록에서 구현 누락 검출

두 출력 형식은 같은 `Printer` 계약을 공유한다. 완성된 목록과 항목이 빠진 목록을 비교한다.

```typescript
type Format = 'plain' | 'boxed';
type Printer = { print(text: string): string };
type Creators = Record<Format, () => Printer>;

const creators = {
  plain: () => ({ print: (text: string) => text }),
  boxed: () => ({ print: (text: string) => '[' + text + ']' })
} satisfies Creators;

function verifyTypes(): void {
  // @ts-expect-error boxed 생성 함수가 빠져 있다.
  const incomplete = { plain: creators.plain } satisfies Creators;
}

console.log(creators.boxed().print('ready'));
```

실행하면 `[ready]`가 출력된다. 주석을 제거하면 `boxed` 키가 누락된 레지스트리에서 타입 오류가 발생한다.

### 사례 3 — 설정에서 읽은 키를 검증한 뒤 생성

설정에서 받은 키로 메모리 카운터나 동작 없는 카운터를 만든다. 지원하지 않는 키면 생성하지 않는다.

```typescript
type Counter = { increment(): number };
type Kind = 'memory' | 'noop';

const creators = {
  memory: () => {
    let value = 0;
    return { increment: () => ++value };
  },
  noop: () => ({ increment: () => 0 })
} satisfies Record<Kind, () => Counter>;

function createCounter(raw: unknown): Counter | undefined {
  if (raw === 'memory' || raw === 'noop') return creators[raw]();
  return undefined;
}

const memory = createCounter('memory');
console.log(memory?.increment(), memory?.increment());
console.log(createCounter('noop')?.increment());
console.log(createCounter('toString'));
```

실행 결과는 `1 2`, `0`, `undefined`다. 타입 검사와 별개로 허용 목록에 없는 값은 실행 중에 걸러진다.

## 관련 문서

여러 생성 단계의 필수 조건을 순서대로 충족하려면 [Builder](builder.md)를 참고한다. 기존 구현을 생성 없이 바꿔 끼우려면 [Strategy](strategy.md)를 참고한다. [TypeScript의 satisfies 연산자](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
