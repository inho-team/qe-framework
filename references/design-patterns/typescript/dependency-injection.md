# 의존성 주입

## 목적

업무 로직에 필요한 의존성의 계약을 선언하고, 사용할 구현은 호출자가 전달하도록 한다. 업무 로직은 구현 선택과 자원 생성에 관여하지 않아도 된다.

## 사용처

저장소, 시계, 네트워크 클라이언트를 실행 환경이나 테스트에서 교체해야 할 때 쓴다. 부수 효과가 없는 계산을 한 곳에서 호출한다면 일반 함수 호출만으로 충분하다.

## 장단점

TypeScript의 구조적 타입 덕분에 필요한 멤버만 선언하고 클래스와 객체 리터럴을 같은 계약에 연결할 수 있다. 의존성이 많아지면 조립 코드가 길어지고, 구조가 일치해도 오류 처리와 데이터 규칙이 같은지는 행동 검증을 통해 확인해야 한다.

## 구현 방식

소비자에서 사용하는 메서드만 인터페이스에 둔다. 생성자나 함수 매개변수로 구현을 받고, 구성 함수에서 환경에 맞는 구현을 결합한다. 연결을 여는 구현의 종료는 조립 지점처럼 그 수명을 결정하는 코드에서 책임진다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 시계를 생성자로 전달

작업 기록에는 현재 시각이 필요하다. 생성자로 받은 시계는 `now`만 제공하면 된다.

```typescript
interface Clock {
  now(): Date;
}

class ActivityLog {
  constructor(private readonly clock: Clock) {}

  entry(message: string): string {
    return this.clock.now().toISOString() + ' ' + message;
  }
}

const fixedClock = { now: () => new Date('2026-01-01T00:00:00Z') };
const log = new ActivityLog(fixedClock);
console.log(log.entry('started'));
```

실행 결과는 `2026-01-01T00:00:00.000Z started`다. `fixedClock`은 `implements`를 선언하지 않아도 필요한 구조를 충족한다.

### 사례 2 — 조립 함수에서 실행 모드별 알림 구현 선택

미리 보기에서는 알림을 버리고 로컬 실행에서는 문자열을 기록한다. 호출자는 동일한 완료 함수를 사용한다.

```typescript
type Notify = (message: string) => void;
type Mode = 'preview' | 'local';

function buildApp(mode: Mode, write: Notify): { complete(task: string): void } {
  const notify: Notify = mode === 'local' ? write : () => {};
  return {
    complete(task) {
      notify(task + ' completed');
    }
  };
}

const messages: string[] = [];
const write: Notify = message => { messages.push(message); };
buildApp('preview', write).complete('draft');
buildApp('local', write).complete('publish');
console.log(messages.join(', '));
```

실행하면 `publish completed`만 출력된다. 모드 분기는 업무 함수 밖에서 처리한다.

### 사례 3 — 테스트 대역과 애플리케이션 구현에 같은 계약 적용

저장소는 존재하지 않는 키를 조회하면 `undefined`를 반환하고 같은 키의 값은 덮어쓴다. 애플리케이션 구현에 `Map`을, 테스트 대역에 행 배열을 쓴다.

```typescript
interface Store {
  put(key: string, value: string): void;
  get(key: string): string | undefined;
}

class MapStore implements Store {
  private readonly rows = new Map<string, string>();
  put(key: string, value: string): void { this.rows.set(key, value); }
  get(key: string): string | undefined { return this.rows.get(key); }
}

function fakeStore(): Store {
  const writes: Array<{ key: string; value: string }> = [];
  return {
    put(key, value) { writes.push({ key, value }); },
    get(key) { return writes.slice().reverse().find(row => row.key === key)?.value; }
  };
}

function verifyContract(store: Store): void {
  if (store.get('a') !== undefined) throw new Error('missing key');
  store.put('a', 'first');
  store.put('a', 'last');
  if (store.get('a') !== 'last') throw new Error('replacement');
}

function verifyTypes(): void {
  // @ts-expect-error put이 빠진 대역은 저장소 계약을 충족하지 않는다.
  verifyContract({ get: () => undefined });
}

verifyContract(new MapStore());
verifyContract(fakeStore());
console.log('contracts passed');
```

실행하면 두 저장소의 동작을 확인한 뒤 `contracts passed`를 출력한다. 주석을 제거하면 저장 메서드가 빠진 대역을 검사에서 거절한다.

## 관련 문서

이미 존재하는 외부 구현의 계약을 맞추려면 [Adapter](adapter.md)를 참고한다. 알고리즘만 바꿔 끼우려면 [Strategy](strategy.md)를 참고한다.
