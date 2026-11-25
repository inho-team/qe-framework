# Pipeline

## 목적

처리를 작은 단계로 나누고 단계의 순서와 중간 결과를 조립한다. 조립 코드는 각 결과를 다음 단계에 전달하고, 개별 단계는 자신이 받는 입력과 만드는 결과에 집중한다.

## 사용처

가져온 데이터를 정규화하고 검증한 뒤 저장하거나, 비동기 작업에서 앞 단계의 결과에 따라 다음 요청을 실행할 때 쓴다. 고정된 호출 몇 개가 의미 있는 순서로 이미 읽힌다면 직접 호출을 이어 쓰면 된다.

## 장단점

같은 단계를 다른 흐름에서 재사용하기 쉽고 변환 하나만 골라 테스트할 수 있다. 단계 수가 늘어나면 중간 타입과 내부 상태를 추적하는 비용도 커진다. 지연 소비를 도입하면 실행 시점과 오류 시점이 달라지고, 기본 순차 동작은 자동 병렬화나 롤백을 제공하지 않는다.

## 구현 방식

단계마다 입력과 출력, 오류 규약을 정한다. 같은 타입에 대한 여러 정규화는 `Callable[[T], T]` 목록으로 다루기 쉽다. 단계별 타입이 다르면 변수에 중간 결과를 담아 순서를 드러내고 각각의 타입을 보존한다. 비동기 흐름에서는 다음 단계가 값을 쓰기 전에 현재 단계를 `await`한다. 한 번만 소비할 수 있는 반복자는 소유 단계와 소비 시점을 정하고, 파일과 세션은 해당 범위를 소유한 블록에서 닫는다.

## 예시

### 사례 1 — 순차 변환을 함수로 합성

상품 검색 색인에 넣을 이름에서 공백을 정규화한 뒤 문자 대소문자를 접는다. 한 번만 순회할 수 있는 입력에 합성된 함수가 언제 적용되는지도 확인한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Callable, Iterator


def compose(*steps: Callable[[str], str]) -> Callable[[str], str]:
    def transform(value: str) -> str:
        for step in steps:
            value = step(value)
        return value

    return transform


def normalize_spacing(value: str) -> str:
    return "-".join(value.split())


consumed: list[str] = []


def product_names() -> Iterator[str]:
    for name in (" Café   Press ", "Fine FILTER"):
        consumed.append(name)
        yield name


build_key = compose(normalize_spacing, str.casefold)
keys = map(build_key, product_names())

assert consumed == []
assert next(keys) == "café-press"
assert consumed == [" Café   Press "]
assert list(keys) == ["fine-filter"]
assert list(keys) == []
```

`map`을 생성한 시점에는 이름을 읽지 않는다. 첫 번째 결과를 요청하면 첫 레코드만 소비하며, 남은 결과를 모두 읽은 뒤에는 같은 반복자에 값이 남지 않는다.

### 사례 2 — 비동기 처리 단계 조립

영수증 발송 단계는 주문 조회 결과로 연락처를 찾아야 한다. 로컬 메모리에서 비동기 대역을 사용해, 각 단계가 완료된 뒤에 다음 단계가 결과를 받는지 확인한다. Python 3.10 이상에서 표준 `asyncio`를 사용한다.

```python
import asyncio
from dataclasses import dataclass


@dataclass(frozen=True)
class Order:
    order_id: str
    customer_id: str
    total_cents: int


completed: list[str] = []
outbox: list[tuple[str, int]] = []


async def load_order(order_id: str) -> Order:
    await asyncio.sleep(0)
    completed.append("order loaded")
    return {"O-75": Order("O-75", "customer-9", 2_450)}[order_id]


async def resolve_email(customer_id: str) -> str:
    await asyncio.sleep(0)
    completed.append("email resolved")
    return {"customer-9": "mina@example.org"}[customer_id]


async def enqueue_receipt(email: str, total_cents: int) -> None:
    await asyncio.sleep(0)
    outbox.append((email, total_cents))
    completed.append("receipt queued")


async def process_receipt(order_id: str) -> None:
    order = await load_order(order_id)
    email = await resolve_email(order.customer_id)
    await enqueue_receipt(email, order.total_cents)


asyncio.run(process_receipt("O-75"))

assert completed == ["order loaded", "email resolved", "receipt queued"]
assert outbox == [("mina@example.org", 2_450)]
```

주문 조회, 이메일 확인, 큐 등록 순으로 완료된다. 마지막 단계가 이전 단계의 연락처와 금액을 받았는지 확인한다.

### 사례 3 — 중간 오류 이후 실행과 정리 범위 확인

재고 파일을 읽고 수량을 검증한 뒤 목록에 일괄 반영한다. 처리 중 입력이 잘못되면 마지막 반영 단계는 호출되지 않고, 실행 범위가 소유한 파일은 닫힌다. Python 3.10 이상에서 표준 라이브러리와 쓰기 가능한 임시 디렉터리를 사용한다.

```python
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TextIO


published: list[list[int]] = []
steps: list[str] = []
opened: list[TextIO] = []


def parse_quantities(raw: str) -> list[int]:
    steps.append("parse")
    quantities = [int(line) for line in raw.splitlines()]
    if any(quantity < 0 for quantity in quantities):
        raise ValueError("stock quantities cannot be negative")
    return quantities


def publish(quantities: list[int]) -> None:
    steps.append("publish")
    published.append(quantities)


def run_import(path: Path) -> None:
    with path.open(encoding="utf-8") as source:
        opened.append(source)  # Retain the handle so the test can inspect it.
        quantities = parse_quantities(source.read())
    publish(quantities)


with TemporaryDirectory() as directory:
    path = Path(directory) / "stock.txt"
    path.write_text("4\n-2\n", encoding="utf-8")
    try:
        run_import(path)
    except ValueError as error:
        assert str(error) == "stock quantities cannot be negative"
    else:
        raise AssertionError("The invalid import must fail")

    assert steps == ["parse"]
    assert opened[0].closed
    assert published == []

    path.write_text("4\n2\n", encoding="utf-8")
    run_import(path)
    assert steps == ["parse", "parse", "publish"]
    assert opened[1].closed
    assert published == [[4, 2]]
```

음수 재고가 있는 실행에서는 파싱 기록만 남고 파일이 닫힌다. 올바른 파일을 다시 실행하면 동일한 단계가 정상적으로 한 번 발행한다. 앞 단계에서 이미 DB 쓰기 같은 외부 효과가 발생하는 경우에는 트랜잭션이나 보상 작업을 별도로 설계한다.

## 관련 문서

- 실행 흐름에 교체 가능한 정책을 주입하는 방식은 [Strategy](strategy.md)에서 다룬다.
- 입력 파일, 세션, 잠금의 수명을 보장하는 방식은 [Context Manager](context-manager.md)에서 다룬다.
- 코루틴을 실행하는 순서는 [Python `asyncio` 문서](https://docs.python.org/3.12/library/asyncio-task.html#coroutines)를 참고한다.
