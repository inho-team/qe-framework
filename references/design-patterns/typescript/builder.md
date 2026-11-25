# Builder

## 목적

객체를 만들기 전에 여러 단계의 필수 조건을 충족하도록 조립 과정을 표현한다. 각 단계는 직전에 받은 입력으로 다음 단계에 필요한 값을 준비한다.

## 사용처

필수 설정을 순서대로 받아야 하거나 앞선 선택이 다음 입력의 타입을 결정할 때 쓴다. 호출자가 값을 한꺼번에 제공할 수 있고 순서가 없다면 옵션 객체로도 충분하다.

## 장단점

조립 도중에 어떤 작업을 할 수 있는지 자동 완성과 타입 검사에서 확인할 수 있다. 단계마다 타입과 객체를 추가해야 하므로 설정이 단순하면 코드가 길어지고, 일반적인 유니온이나 제네릭을 여러 겹 쓰면 호출자가 진단을 읽기 어려워진다.

## 구현 방식

단계마다 그 시점에 허용되는 메서드만 반환한다. 빌드 함수는 필수 단계가 끝난 타입에만 둔다. 조립 중에 저장한 입력이 바뀌지 않도록 필요한 경우 복사하고, 외부 값 검증과 자원 획득은 오류를 처리하고 소유권을 넘길 수 있는 단계에서 수행한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 필수 단계로 요청 조립

내보내기 요청에는 경로와 권한 정보가 필요하다. 두 값을 순서대로 전달한 뒤 요청을 만든다.

```typescript
type RequestSpec = Readonly<{ path: string; authorization: string }>;
type NeedsPath = { path(value: string): NeedsToken };
type NeedsToken = { token(value: string): CanBuild };
type CanBuild = { build(): RequestSpec };

function request(): NeedsPath {
  return {
    path(path) {
      return {
        token(value) {
          return {
            build: () => ({ path, authorization: 'Bearer ' + value })
          };
        }
      };
    }
  };
}

console.log(request().path('/exports').token('demo').build());
```

실행하면 경로가 `/exports`이고 인증 헤더 값이 `Bearer demo`인 객체가 출력된다. `demo`는 로컬 예제용 문자열이다.

### 사례 2 — 디코더 결과를 다음 단계의 입력으로 연결

설정값을 해석한 뒤 화면 표시값으로 변환한다. 디코더가 반환하는 타입이 변환 함수의 입력 타입을 결정한다.

```typescript
function decodeWith<Value>(decode: (source: string) => Value) {
  return {
    map<Output>(convert: (value: Value) => Output) {
      return {
        build(): (source: string) => Output {
          return source => convert(decode(source));
        }
      };
    }
  };
}

const formatQuantity = decodeWith(source => {
  const amount = Number(source);
  if (!Number.isSafeInteger(amount) || amount < 0 || source.trim() === '') {
    throw new Error('invalid quantity');
  }
  return amount;
}).map(amount => amount.toFixed(2)).build();

console.log(formatQuantity('7'));
try {
  formatQuantity('seven');
} catch (error) {
  if (!(error instanceof Error)) throw error;
  console.log(error.message);
}
```

실행하면 `7.00`과 `invalid quantity`가 출력된다. `map`의 입력이 숫자로 추론되고 완성된 함수는 문자열을 반환한다. 숫자 입력 검증은 실제 호출에서 디코더가 처리한다.

### 사례 3 — 일찍 빌드하거나 단계를 건너뛰는 호출 검출

보고서에는 기간과 출력 형식이 필요하다. 기간을 정하고 형식을 선택해야 빌드할 수 있다.

```typescript
type Format = 'csv' | 'json';

function report() {
  return {
    period(value: 'today' | 'week') {
      return {
        format(format: Format) {
          return {
            build: () => ({ period: value, format })
          };
        }
      };
    }
  };
}

function verifyTypes(): void {
  // @ts-expect-error 형식을 지정하기 전에는 build가 없다.
  report().period('today').build();
  // @ts-expect-error 시작 단계에서는 기간을 지정해야 한다.
  report().format('csv');
}

console.log(report().period('week').format('json').build());
```

실행하면 `period`가 `week`이고 `format`이 `json`인 객체가 출력된다. 두 주석을 제거하면 아직 제공되지 않은 메서드에 접근하는 호출에서 타입 오류가 발생한다.

## 관련 문서

설정을 한 번에 전달할 수 있다면 [옵션 객체](options-object.md)를 참고한다. 종류에 따른 구현 선택은 [Factory](factory.md)에서 다룬다.
