# Decorator

## 목적

함수의 호출 전후에 계측, 캐시, 추적처럼 여러 함수에서 쓰는 동작을 덧붙인다. 래퍼는 실행할 시점과 부가 동작을 맡으며, 원래 함수는 자신의 계산과 도메인 오류를 관리한다.

## 사용처

같은 방식의 계측을 여러 진입점에 적용하거나 프레임워크가 데코레이터를 연결 지점으로 제공할 때 쓴다. 한 함수에서 한 번 기록하면 되는 경우에는 함수 내부에 직접 기록하는 편이 흐름을 따라가기 쉽다.

## 장단점

반복을 줄이고 적용 위치를 선언으로 드러낼 수 있다. 여러 데코레이터를 쌓으면 적용 순서에 따라 캐시 적중이나 로깅 시점이 달라지고, 래퍼 호출과 계측 비용도 추가된다. `functools.wraps`는 메타데이터 보존을 돕고 `ParamSpec`은 정적 호출 서명을 표현한다. 실제 인자 전달과 반환, 예외 동작은 래퍼 코드가 보존해야 한다.

## 구현 방식

일반 함수는 래퍼에서 호출하고 코루틴 함수는 비동기 래퍼 안에서 `await`한다. 동기 제너레이터는 `yield from`으로 순회를 위임해 실제 소비 시점에 작업을 수행한다. 반드시 기록해야 하는 처리는 `finally`에 두고, 계측 코드의 실패가 원래 예외를 덮지 않도록 기록 함수의 오류 규약을 정한다.

## 예시

### 사례 1 — wraps로 함수 계약을 보존하며 계측

세금 계산 함수에 호출 횟수를 기록한다. 원래 함수의 메타데이터, 키워드 전용 인자, 반환값을 그대로 사용한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections import Counter
from collections.abc import Callable
from functools import wraps
from inspect import signature
from typing import ParamSpec, TypeVar


P = ParamSpec("P")
R = TypeVar("R")
calls: Counter[str] = Counter()


def counted(function: Callable[P, R]) -> Callable[P, R]:
    @wraps(function)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        calls[function.__qualname__] += 1
        return function(*args, **kwargs)

    return wrapper


@counted
def sales_tax(cents: int, *, rate_percent: int) -> int:
    """Return the tax in whole cents."""
    return cents * rate_percent // 100


assert sales_tax(1_250, rate_percent=8) == 100
assert sales_tax.__name__ == "sales_tax"
assert sales_tax.__doc__ == "Return the tax in whole cents."
assert list(signature(sales_tax).parameters) == ["cents", "rate_percent"]
assert calls["sales_tax"] == 1
```

세액은 100센트이며 호출 계수만 증가한다. `inspect.signature`는 기본적으로 `__wrapped__`를 따라 원래 서명을 표시한다. `assert`로 이름, 문서 문자열, 인자 이름과 반환값을 확인한다.

### 사례 2 — async 함수의 실행 시간 기록

비동기 재고 조회를 실제로 실행하는 동안의 시간을 잰다. 예시는 테스트용 시계와 메모리 기록 목록을 사용하므로 실행 시간 검증에 실제 시계를 사용하지 않는다. Python 3.11 이상에서 표준 라이브러리만 사용한다.

```python
import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from functools import wraps
from time import perf_counter
from typing import Any, ParamSpec, TypeVar


P = ParamSpec("P")
R = TypeVar("R")


def timed(
    function: Callable[P, Awaitable[R]],
    record: Callable[[float], None],
    clock: Callable[[], float] = perf_counter,
) -> Callable[P, Coroutine[Any, Any, R]]:
    @wraps(function)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        started_at = clock()
        try:
            return await function(*args, **kwargs)
        finally:
            record(clock() - started_at)

    return wrapper


async def lookup(sku: str) -> int:
    await asyncio.sleep(0)
    return {"B-20": 6}[sku]


async def main() -> None:
    readings: list[float] = []
    times = iter([100.0, 100.25, 101.0, 101.5])
    instrumented = timed(lookup, readings.append, lambda: next(times))
    lookup_call = instrumented("B-20")
    assert readings == []
    assert await lookup_call == 6
    assert readings == [0.25]

    entered = asyncio.Event()
    pending = asyncio.Event()

    async def slow_lookup() -> int:
        entered.set()
        await pending.wait()
        return 0

    slow = timed(slow_lookup, readings.append, lambda: next(times))
    task = asyncio.create_task(slow())
    async with asyncio.timeout(2):
        await entered.wait()

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        assert task.cancelled()
    else:
        raise AssertionError("Task cancellation must propagate")
    assert readings == [0.25, 0.5]


asyncio.run(main())
```

코루틴을 만드는 순간에는 기록이 없다. `await`가 완료되면 조회값 6과 실행 시간 0.25초를 확인한다. 두 번째 태스크는 진입 후 취소되며, `finally`에서 0.5초를 기록한 뒤 호출자에게 `CancelledError`를 전달한다. 예시의 기록 함수는 메모리 목록에 값을 추가한다.

### 사례 3 — 제너레이터의 실행 시점과 종료 보존

로그 행을 지연 생성하는 제너레이터에 순회 계측을 더한다. 분리된 두 제너레이터로 중간 종료와 읽기 오류를 검증한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Callable, Generator
from functools import wraps


events: list[str] = []


def traced(
    function: Callable[[], Generator[str, None, None]],
) -> Callable[[], Generator[str, None, None]]:
    @wraps(function)
    def wrapper() -> Generator[str, None, None]:
        events.append("started")
        try:
            yield from function()
        finally:
            events.append("finished")

    return wrapper


@traced
def log_lines() -> Generator[str, None, None]:
    try:
        yield "ready"
        raise OSError("log read failed")
    finally:
        events.append("source closed")


lines = log_lines()
assert events == []
assert next(lines) == "ready"
assert events == ["started"]
lines.close()
assert events == ["started", "source closed", "finished"]

events.clear()
failing_lines = log_lines()
assert next(failing_lines) == "ready"
try:
    next(failing_lines)
except OSError as error:
    assert str(error) == "log read failed"
else:
    raise AssertionError("The read error must reach the caller")
assert events == ["started", "source closed", "finished"]
```

첫 `next()`에서만 실행이 시작된다. `close()`와 읽기 실패 모두 원본 제너레이터를 먼저 정리한 뒤 계측을 종료하며, 읽기 실패는 호출자가 받는다.

## 관련 문서

- 파일과 세션의 사용 범위를 관리하는 방식은 [Context Manager](context-manager.md)에서 다룬다.
- 여러 변환을 순서대로 조립하는 방식은 [Pipeline](pipeline.md)에서 다룬다.
- 래퍼의 메타데이터 처리는 [Python `functools.wraps` 문서](https://docs.python.org/3.12/library/functools.html#functools.wraps)를 참고한다.
