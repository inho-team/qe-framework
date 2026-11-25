# 옵션 객체

## 목적

호출에서 선택할 수 있는 값을 이름 있는 필드로 전달한다. 함수는 생략할 수 있는 값, 기본값, 함께 지정해야 할 필드를 한 계약에 둔다.

## 사용처

여러 선택 값을 전달하거나 인수의 위치만으로 뜻을 읽기 어려울 때 쓴다. 필수 인수가 하나이고 역할이 분명하다면 일반 매개변수로 충분하다.

## 장단점

이름을 보고 호출의 의도를 알 수 있고 선택 필드를 추가할 때 기존 호출의 인수 순서를 바꿀 필요가 없다. 옵션 조합이 많아지면 판별 유니온이 복잡해지고, 기본값이나 `undefined`의 의미를 바꾸면 타입이 같아도 실행 결과가 달라질 수 있다.

## 구현 방식

일반 선택 필드는 `?`로 선언하고 함수 입구에서 기본값을 정한다. 함께 필요한 필드는 판별 유니온의 같은 멤버에 둔다. 필드 생략과 명시적 `undefined`를 구분해야 하면 `exactOptionalPropertyTypes`를 검토하고, 실행 중에는 필드 존재 여부를 확인한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 이름이 있는 호출 옵션과 기본값

표시 문구에 접두사를 붙일 수 있고 호출자가 대문자 변환 여부를 고를 수 있다.

```typescript
type LabelOptions = { prefix?: string; uppercase?: boolean };

function label(value: string, { prefix = '', uppercase = false }: LabelOptions = {}): string {
  return prefix + (uppercase ? value.toUpperCase() : value);
}

console.log(label('draft'));
console.log(label('draft', { prefix: '# ', uppercase: true }));
```

실행하면 `draft`와 `# DRAFT`가 표시된다. 옵션 객체 전체나 개별 필드를 생략하면 해당 기본값을 사용한다.

### 사례 2 — 선택한 저장 방식에 필요한 필드 명시

내보내기 결과를 메모리에 보관하거나 지정 경로에 저장한다. 테스트는 문자열만 반환하므로 파일을 만들 필요가 없다.

```typescript
type Destination =
  | { kind: 'memory' }
  | { kind: 'file'; path: string };

function destinationName(options: Destination): string {
  return options.kind === 'file' ? options.path : 'memory';
}

function verifyTypes(): void {
  // @ts-expect-error 파일 방식에는 path가 필요하다.
  destinationName({ kind: 'file' });
}

console.log(destinationName({ kind: 'memory' }));
console.log(destinationName({ kind: 'file', path: 'report.csv' }));
```

실행 결과는 `memory`와 `report.csv`다. 주석을 제거하면 파일 옵션에 경로가 빠진 호출을 타입 검사에서 거절한다.

### 사례 3 — 생략, 명시적 해제, 잘못된 undefined 구분

알림 설정에서 필드를 생략하면 기존 값을 유지하고 `null`이면 수신 주소를 지운다. `undefined`는 잘못된 입력으로 다룬다. 이 사례는 TypeScript 4.9 이상에서 `--strict --exactOptionalPropertyTypes`를 함께 사용한다.

```typescript
type NotificationPatch = { subscriber?: string | null };

function applyPatch(current: string | null, patch: NotificationPatch): string | null {
  if ('subscriber' in patch) return patch.subscriber;
  return current;
}

function parsePatch(value: unknown): NotificationPatch | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('subscriber' in value)) return {};
  if (value.subscriber === null || typeof value.subscriber === 'string') {
    return { subscriber: value.subscriber };
  }
  return undefined;
}

function verifyTypes(): void {
  // @ts-expect-error 선택 필드는 생략할 수 있지만 명시적인 undefined는 허용하지 않는다.
  applyPatch('old', { subscriber: undefined });
}

console.log(applyPatch('old', {}));
console.log(applyPatch('old', { subscriber: null }));
console.log(parsePatch({ subscriber: undefined }) === undefined ? 'invalid' : 'accepted');
```

실행하면 `old`, `null`, `invalid`가 출력된다. 주석을 제거하면 명시적 `undefined`가 타입 검사에서 거절된다. 외부 데이터에도 같은 규칙을 적용하도록 `parsePatch`가 입력을 검사한다.

## 관련 문서

순서대로 충족해야 하는 조건은 [Builder](builder.md)를 참고한다. 외부 옵션의 검증은 [Adapter](adapter.md)에서 다룬다. [TypeScript의 exactOptionalPropertyTypes 설정](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
