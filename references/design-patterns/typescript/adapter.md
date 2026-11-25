# Adapter

## 목적

외부 데이터의 형식이나 클라이언트의 호출 방법을 애플리케이션이 사용하는 계약에 맞춘다. 이름 변환, 값 검증, 오류 매핑을 경계에서 맡아 소비자가 같은 처리를 반복하지 않도록 한다.

## 사용처

외부 응답의 필드나 오류가 공급자마다 다르거나 변경 주기가 내부 모델과 다를 때 쓴다. 두 계약이 이미 일치하고 교체 가능성만 필요하다면 소비자의 인터페이스에 구현을 바로 주입해도 된다.

## 장단점

소비자의 타입과 오류 처리가 안정되고 잘못된 응답을 경계 테스트에서 재현할 수 있다. 외부 계약이 바뀔 때는 변환을 갱신해야 하고 큰 페이로드를 검증하거나 복사하면 처리 비용이 생긴다.

## 구현 방식

소비자가 사용하는 타입을 먼저 정한다. 출처를 신뢰할 수 없는 값은 `unknown`으로 받아 객체 여부, 판별자, 필수 필드 및 값의 범위를 검사한 뒤 새 도메인 값을 만든다. 외부 오류는 처리할 수 있는 경우만 내부 계약으로 변환하고, 예상하지 못한 오류는 원인을 보존해 전달한다.

## 예시

공통 전제와 실행 명령은 [예제 검증](README.md#예제-검증)을 따른다.

### 사례 1 — 재고 API 응답을 도메인 값으로 변환

재고의 외부 필드 이름을 바꾸고 수량으로 음수나 소수를 받지 않는다.

```typescript
type Inventory = { sku: string; available: number };

function toInventory(input: unknown): Inventory | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  if (!('sku_code' in input) || typeof input.sku_code !== 'string') return undefined;
  if (!('quantity' in input) || typeof input.quantity !== 'number') return undefined;
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) return undefined;

  return { sku: input.sku_code, available: input.quantity };
}

console.log(toInventory({ sku_code: 'X1', quantity: 0 }));
console.log(toInventory({ sku_code: 'X1', quantity: -2 }));
```

컴파일 후 실행하면 첫 줄에서 `{ sku: 'X1', available: 0 }`을, 둘째 줄에서 `undefined`를 확인할 수 있다.

### 사례 2 — 외부 클라이언트의 부재 오류 매핑

메모리 클라이언트는 HTTP 상태를 가진 오류를 던진다. 내부 조회 함수는 404를 검색 결과의 한 종류로 반환하고 다른 오류는 호출자에게 전달한다.

```typescript
class ClientError extends Error {
  constructor(readonly status: number) {
    super('HTTP ' + status);
  }
}

type Client = { get(id: string): Promise<{ label: string }> };
type Lookup = { kind: 'found'; label: string } | { kind: 'missing' };

async function lookup(client: Client, id: string): Promise<Lookup> {
  try {
    const response = await client.get(id);
    return { kind: 'found', label: response.label };
  } catch (error) {
    if (error instanceof ClientError && error.status === 404) return { kind: 'missing' };
    throw error;
  }
}

const client: Client = {
  async get(id) {
    if (id === 'missing') throw new ClientError(404);
    if (id === 'unavailable') throw new ClientError(503);
    return { label: id };
  }
};

async function main(): Promise<void> {
  console.log((await lookup(client, 'Ada')).kind);
  console.log((await lookup(client, 'missing')).kind);
  try {
    await lookup(client, 'unavailable');
  } catch (error) {
    if (!(error instanceof ClientError)) throw error;
    console.log(error.status);
  }
}

void main();
```

실행하면 `found`, `missing`, `503`이 차례로 출력된다. 오류 클래스는 메모리 클라이언트가 사용하는 계약이다.

### 사례 3 — 옵션 필드 누락과 위조된 판별자 거절

저장된 내보내기 옵션을 읽는다. CSV의 구분자는 생략할 수 있고, 압축 형식에는 파일명이 필요하다.

```typescript
type ExportOptions =
  | { format: 'csv'; delimiter?: ',' | ';' }
  | { format: 'zip'; filename: string };

function parseOptions(value: unknown): ExportOptions | undefined {
  if (typeof value !== 'object' || value === null || !('format' in value)) return undefined;
  if (value.format === 'csv') {
    if (!('delimiter' in value)) return { format: 'csv' };
    if (value.delimiter === ',' || value.delimiter === ';') {
      return { format: 'csv', delimiter: value.delimiter };
    }
  }
  if (value.format === 'zip' && 'filename' in value &&
      typeof value.filename === 'string' && value.filename.length > 0) {
    return { format: 'zip', filename: value.filename };
  }
  return undefined;
}

console.log(parseOptions({ format: 'csv' }));
console.log(parseOptions({ format: 'zip' }));
console.log(parseOptions({ format: 'tar', filename: 'report.tar' }));
console.log(parseOptions({ format: 'csv', delimiter: '|' }));
```

실행하면 CSV 구분자를 생략한 첫 입력이 받아들여진다. 파일명이 없는 ZIP, 지원하지 않는 형식과 잘못된 구분자는 각각 `undefined`를 반환한다.

## 관련 문서

변환한 구현을 소비자에게 연결하려면 [의존성 주입](dependency-injection.md)을 참고한다. 판별자별 필수 옵션은 [옵션 객체](options-object.md)에 정리되어 있다. [TypeScript의 타입 좁히기](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
