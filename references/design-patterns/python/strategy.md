# Strategy

## 목적

서비스에서 자주 교체되는 결정 로직을 별도의 호출 가능 객체에 맡긴다. 서비스는 입력을 준비하고 정책의 결과를 적용하며, 정책은 정렬 기준이나 가격, 유효성 검증 등의 규칙을 결정한다.

## 사용처

같은 주문 흐름을 유지하면서 배송 방법에 따라 분류 규칙이 달라지거나, 고객군마다 가격 정책을 따로 시험해야 할 때 쓴다. 고정된 비교 함수 하나로 모든 호출을 처리할 수 있으면 그 함수를 직접 호출하는 편이 읽기 쉽다.

## 장단점

함수를 전달하면 클래스 계층 없이도 규칙을 바꿀 수 있고, 정책별 경계값을 개별 테스트하기 쉽다. 각 구현의 반환값, 예외, 부수 효과를 맞추는 비용이 생긴다. 정책이 상태를 보관하면 인스턴스를 어느 요청에서 공유하는지에 따라 결과가 달라질 수 있다.

## 구현 방식

소비자가 `Callable` 또는 `__call__`을 정의한 `Protocol`로 입력과 결과를 표현한다. 동기 함수는 호출하면 값을 반환하고, 코루틴 함수는 호출한 결과를 `await`해야 값과 예외를 얻는다. 구성 단계에서 호출 규약에 맞는 정책을 선택하고, 외부 실패를 변환하거나 재시도할 책임도 정한다.

## 예시

### 사례 1 — Callable로 분류 정책 주입

지원 티켓 목록을 처리하는 흐름에 점수 정책과 키워드 정책을 각각 전달한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Callable, Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class Ticket:
    subject: str
    priority: int


Classification = Callable[[Ticket], str]


def classify_by_score(ticket: Ticket) -> str:
    return "urgent" if ticket.priority >= 8 else "normal"


def classify_by_subject(ticket: Ticket) -> str:
    return "urgent" if "outage" in ticket.subject.lower() else "normal"


def classify(tickets: Iterable[Ticket], policy: Classification) -> list[str]:
    return [policy(ticket) for ticket in tickets]


tickets = [Ticket("Login outage", 7), Ticket("Account request", 8)]
assert classify(tickets, classify_by_score) == ["normal", "urgent"]
assert classify(tickets, classify_by_subject) == ["urgent", "normal"]
```

같은 티켓 목록에 대한 분류가 정책에 따라 뒤바뀐다. 두 `assert`는 기준값 8과 제목의 `outage`가 각각 다른 티켓을 긴급으로 분류하는지 확인한다.

### 사례 2 — 상태를 가진 호출 가능 객체 사용

창고마다 출고 가능 중량이 다르다. 창고별 설정을 인스턴스 상태로 보관하고 동일한 출고 계산 함수에서 사용한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class WeightLimit:
    max_grams: int

    def __call__(self, grams: int) -> bool:
        return 0 < grams <= self.max_grams


def accepted_weight(
    weights: list[int], accepts: Callable[[int], bool]
) -> int:
    return sum(grams for grams in weights if accepts(grams))


city_warehouse = WeightLimit(max_grams=1_000)
central_warehouse = WeightLimit(max_grams=2_000)
packages = [0, 1_000, 1_500]

assert accepted_weight(packages, city_warehouse) == 1_000
assert accepted_weight(packages, central_warehouse) == 2_500
```

두 인스턴스가 서로 다른 허용 중량을 유지한다. `assert`로 경계값인 1,000g과 허용 범위를 벗어나는 0g을 포함한 입력의 합계를 확인한다.

### 사례 3 — 동기 정책과 코루틴 정책의 오류 규약 확인

픽업 가능 여부를 조회하는 정책은 제한 시간 초과를 `TimeoutError`로 알린다. 동기 소비자와 비동기 소비자는 그 예외만 도메인 오류로 변환한다. Python 3.11 이상과 표준 `asyncio`를 사용한다.

```python
import asyncio
from collections.abc import Awaitable, Callable


class PickupUnavailable(RuntimeError):
    pass


def check_pickup(query: Callable[[str], bool], store: str) -> bool:
    try:
        return query(store)
    except TimeoutError as error:
        raise PickupUnavailable(store) from error


async def check_pickup_async(
    query: Callable[[str], Awaitable[bool]], store: str
) -> bool:
    try:
        return await query(store)
    except TimeoutError as error:
        raise PickupUnavailable(store) from error


def local_query(store: str) -> bool:
    if store == "offline":
        raise TimeoutError("inventory lookup exceeded its deadline")
    return store == "open"


async def remote_query(store: str) -> bool:
    await asyncio.sleep(0)
    return local_query(store)


assert check_pickup(local_query, "closed") is False
try:
    check_pickup(local_query, "offline")
except PickupUnavailable as error:
    assert isinstance(error.__cause__, TimeoutError)
else:
    raise AssertionError("Timeout must become PickupUnavailable")


async def main() -> None:
    assert await check_pickup_async(remote_query, "open") is True
    assert await check_pickup_async(remote_query, "closed") is False
    try:
        await check_pickup_async(remote_query, "offline")
    except PickupUnavailable as error:
        assert isinstance(error.__cause__, TimeoutError)
    else:
        raise AssertionError("Timeout must become PickupUnavailable")


asyncio.run(main())
```

재고가 없어 `False`를 반환하는 경우와 조회 자체가 실패한 경우를 구분한다. 두 소비자가 동일한 원인 예외를 보존하는지 확인한다. 비동기 소비자는 `TimeoutError`만 처리하므로 태스크 취소는 호출자에게 전파된다.

## 관련 문서

- 여러 단계를 순서대로 적용하는 흐름은 [Pipeline](pipeline.md)에서 다룬다.
- 외부 호출의 이름, 응답 형식, 오류 의미를 바꾸는 경계는 [Adapter](adapter.md)에서 다룬다.
- 코루틴 호출과 태스크 취소 동작은 [Python `asyncio` 문서](https://docs.python.org/3.12/library/asyncio-task.html#coroutines)를 참고한다.
