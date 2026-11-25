# State

## 목적

현재 상태와 그 상태에서 유효한 데이터를 하나의 값으로 표현한다. 소비자는 판별자를 확인한 뒤 필요한 데이터나 허용된 작업에 접근한다.

## 사용처

화면의 로드 결과처럼 경우마다 필수 필드가 다르거나 문서 승인처럼 상태가 다음 작업을 제한할 때 쓴다. 데이터와 허용 작업이 모두 같고 표시만 달라진다면 리터럴 유니온만으로 충분하다.

## 장단점

판별 유니온을 좁히면 관련 데이터에 바로 접근할 수 있고, 상태를 추가하면 빠진 분기를 타입 검사에서 찾을 수 있다. 상태와 전이가 많아질수록 소비자의 분기와 전이 테스트도 함께 늘어난다.

## 구현 방식

각 멤버에 같은 이름의 리터럴 판별자를 두고 상태에 필요한 필드를 그 멤버에 선언한다. 전이 함수는 허용되는 이전 상태의 타입을 받는다. 외부에서 온 상태는 판별자와 필수 필드를 함께 검증한 뒤 내부 전이 함수에 전달한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 화면의 로드 결과 표시

화면이 로드하는 동안에는 안내 문구를 표시하고 완료되면 이름이나 실패 이유를 표시한다.

```typescript
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; name: string }
  | { kind: 'failed'; reason: string };

function label(state: LoadState): string {
  switch (state.kind) {
    case 'loading': return '불러오는 중';
    case 'ready': return state.name;
    case 'failed': return state.reason;
  }
}

console.log(label({ kind: 'loading' }));
console.log(label({ kind: 'ready', name: 'Ada' }));
console.log(label({ kind: 'failed', reason: '연결 끊김' }));
```

컴파일 후 실행하면 세 줄에 `불러오는 중`, `Ada`, `연결 끊김`이 차례로 표시된다. `ready` 분기에서만 `name`에 접근할 수 있다.

### 사례 2 — 제출된 문서만 게시

초안에는 제출 일시가 생기기 전까지 게시를 허용하지 않는다. 이전 단계의 데이터는 다음 상태에 보존한다.

```typescript
type Draft = { kind: 'draft'; title: string };
type Submitted = { kind: 'submitted'; title: string; submittedAt: string };
type Published = { kind: 'published'; title: string; submittedAt: string; publicId: string };

function submit(draft: Draft, submittedAt: string): Submitted {
  return { ...draft, kind: 'submitted', submittedAt };
}

function publish(document: Submitted, publicId: string): Published {
  return { ...document, kind: 'published', publicId };
}

function verifyTypes(draft: Draft): void {
  // @ts-expect-error 게시하려면 제출 상태가 필요하다.
  publish(draft, 'p-1');
  // @ts-expect-error 제출 일시가 빠진 상태는 허용되지 않는다.
  const invalid: Submitted = { kind: 'submitted', title: 'Notes' };
}

console.log(publish(submit({ kind: 'draft', title: 'Notes' }, '2026-01-01'), 'p-1').publicId);
```

`p-1`이 출력된다. 타입 검사에서 두 주석을 각각 제거하면 잘못된 전이와 제출 일시 누락이 진단된다. 예제에서는 일시를 내부에서 제공한다.

### 사례 3 — 새 배송 상태에 대한 표시 누락

배송 화면에 `returned` 상태를 추가했을 때 기존 렌더러의 분기 누락을 찾는다.

```typescript
type DeliveryState = 'queued' | 'sent' | 'returned';

function legacyLabel(state: DeliveryState): string {
  switch (state) {
    case 'queued': return '대기';
    case 'sent': return '발송';
    default: {
      // @ts-expect-error 반환 상태의 분기가 빠져 있다.
      const unexpected: never = state;
      throw new Error('처리되지 않은 배송 상태: ' + unexpected);
    }
  }
}
```

이 블록은 `--noEmit`으로 검사한다. 주석을 지우면 `returned`를 `never`에 대입할 수 없다는 진단이 나온다. `case 'returned': return '반송';`을 추가하고 주석을 지우면 타입 검사가 통과한다.

## 관련 문서

외부 상태를 읽는 경계는 [Adapter](adapter.md)에 둔다. 단계마다 생성 조건을 확인하려면 [Builder](builder.md)를 참고한다. [TypeScript의 판별 유니온과 분기 완전성 검사](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
