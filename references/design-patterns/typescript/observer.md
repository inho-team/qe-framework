# Observer

## 목적

이벤트 발행자가 반응할 대상을 알지 않아도 변경을 전달할 수 있도록 한다. 이벤트의 이름과 페이로드 계약을 정의하고 구독자마다 반응을 구현한다.

## 사용처

저장소 갱신을 화면과 감사 기록이 함께 받아야 할 때처럼 여러 소비자가 독립적으로 반응할 때 쓴다. 고정된 소비자 하나가 후속 작업을 한다면 결과를 반환하고 직접 호출해도 된다.

## 장단점

발행자와 구독자를 따로 변경할 수 있고 이벤트별 페이로드를 타입 검사할 수 있다. 등록을 해제하지 않으면 구독이 살아남고, 콜백 예외와 실행 순서도 명시적으로 결정해야 한다.

## 구현 방식

이벤트 이름을 페이로드에 매핑한다. 호출에 이름과 페이로드를 함께 넘긴다면 판별 가능한 튜플 유니온으로 두 값의 관계를 유지할 수 있다. 구독 수명은 해제 함수를 받은 쪽이 관리한다. 동기 발행에서는 콜백 순서, 중간 해제나 재구독, 예외 전파 정책을 정한다. 외부 이벤트는 형식과 값 범위를 확인한 다음 발행한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 이벤트 이름별 페이로드 계약

미리 보기 도구는 진행률과 완료 파일 경로를 서로 다른 이벤트로 전달한다.

```typescript
type Events = {
  progress: { percent: number };
  complete: { path: string };
};
type EventArgs = {
  [Name in keyof Events]: [name: Name, payload: Events[Name]]
}[keyof Events];
const listeners: { [Name in keyof Events]: Array<(payload: Events[Name]) => void> } = {
  progress: [],
  complete: []
};

function subscribe<Name extends keyof Events>(
  name: Name,
  listener: (payload: Events[Name]) => void
): void {
  listeners[name].push(listener);
}

function publish(...[name, payload]: EventArgs): void {
  if (name === 'progress') {
    for (const listener of listeners.progress) listener(payload);
  } else {
    for (const listener of listeners.complete) listener(payload);
  }
}

function verifyTypes(): void {
  // @ts-expect-error 완료 이벤트에는 경로가 필요하다.
  publish('complete', { percent: 100 });
}

subscribe('progress', payload => console.log(payload.percent + '%'));
subscribe('complete', payload => console.log(payload.path));
publish('progress', { percent: 50 });
publish('complete', { path: '/exports/report.csv' });
```

실행하면 `50%`와 `/exports/report.csv`가 출력된다. 주석을 제거하면 이름과 페이로드가 어긋난 호출이 진단된다.

### 사례 2 — 저장 이벤트에 여러 소비자 연결

메모리 저장소가 레코드 갱신을 알린다. 화면과 감사 기록은 각각 콜백을 등록한다.

```typescript
type Update = Readonly<{ id: string; value: string }>;
type Listener = (update: Update) => void;

class Store {
  private readonly entries = new Map<string, string>();
  private readonly listeners = new Set<Listener>();

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  set(id: string, value: string): void {
    this.entries.set(id, value);
    const update = { id, value };
    for (const listener of [...this.listeners]) listener(update);
  }
}

const store = new Store();
const audit: string[] = [];
const stopView = store.onUpdate(update => console.log('display ' + update.value));
const stopAudit = store.onUpdate(update => { audit.push(update.id); });
store.set('row-1', 'ready');
console.log('audit ' + audit.join(', '));
stopView();
stopAudit();
```

실행하면 `display ready`와 `audit row-1`이 출력된다. 예제는 발행 시작 때 등록된 목록을 순서대로 호출한다. 콜백 중 변경된 등록은 다음 발행부터 반영되며, 콜백이 예외를 던지면 저장은 유지되고 그 발행의 남은 콜백은 실행되지 않는다.

### 사례 3 — 외부 값 검증과 구독 해제

센서 입력은 `unknown`으로 들어온다. 등록된 하나의 소비자가 유한한 수치만 받도록 하고, 생산자는 소비자의 등록 해제 뒤에도 입력을 받을 수 있다.

```typescript
type Listener = (value: number) => void;

function createSource() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener): () => void {
      const subscription: Listener = value => listener(value);
      listeners.add(subscription);
      return () => { listeners.delete(subscription); };
    },
    receive(input: unknown): boolean {
      if (typeof input !== 'object' || input === null || !('value' in input) ||
          typeof input.value !== 'number' || !Number.isFinite(input.value)) return false;

      for (const listener of [...listeners]) listener(input.value);
      return true;
    }
  };
}

const source = createSource();
const readings: number[] = [];
const record: Listener = value => { readings.push(value); };
const unsubscribe = source.subscribe(record);
console.log(source.receive({ value: '12' }));
console.log(source.receive({ value: 12 }));
unsubscribe();
console.log(source.receive({ value: 18 }));
const stopAgain = source.subscribe(record);
unsubscribe();
console.log(source.receive({ value: 20 }));
console.log(readings.join(', '));
stopAgain();
```

실행 결과는 `false`, `true`, `true`, `true`, `12, 20`이다. 문자열 입력과 구독 해제 중 받은 값은 전달되지 않는다. 재구독한 뒤 이전 해제 함수를 다시 호출해도 새 구독은 유지된다.

## 관련 문서

공급자별 이벤트 형식을 변환하려면 [Adapter](adapter.md)를 참고한다. 이벤트로 전달된 상태에 맞는 데이터 모델은 [State](state.md)를 참고한다.
