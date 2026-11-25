# Context Manager

## 목적

자원을 확보하고 사용하는 범위를 한 블록에 표시한다. 컨텍스트 매니저는 파일, 세션, 잠금 등의 초기화와 해제를 맡고, 블록은 확보된 자원으로 수행할 작업을 맡는다.

## 사용처

파일을 닫거나 잠금을 해제해야 하는 작업에 쓴다. 블록 수명이 분명한 파일은 내장 `with open(...)`으로 처리할 수 있다. 자원 수가 실행 중에 정해지거나 여러 정리 동작을 한 블록에 묶어야 하는 경우에는 `ExitStack`을 고려한다.

## 장단점

정상 종료와 예외 경로에서 같은 정리 코드를 사용하며 소유권을 읽기 쉽게 표현할 수 있다. 블록을 벗어나기 전에 데이터를 모두 소비해야 하고, 자원 진입 코드에 일부만 성공하는 단계가 있으면 해당 단계의 정리까지 설계해야 한다. 비동기 정리에서 대기가 필요하면 추가 취소와 정리 오류에 대한 규약이 중요하다.

## 구현 방식

`with`는 `__enter__`로 자원을 확보하고 진입이 끝난 뒤 `__exit__`로 정리한다. `contextmanager`에서는 `yield`로 자원을 전달하고 `finally`에서 해제한다. `async with`와 `asynccontextmanager`는 비동기 확보와 정리를 지원한다. 블록에서 발생한 오류를 처리했다고 명시하는 경우에만 예외를 삼킨다.

## 예시

### 사례 1 — 파일을 with 블록에서 정리

임시 파일에서 첫 줄을 읽고 처리 과정에서 오류가 일어나도 파일을 닫는다. Python 3.10 이상에서 표준 라이브러리만 사용하며 로컬 임시 디렉터리에 쓸 수 있어야 한다.

```python
from pathlib import Path
from tempfile import TemporaryDirectory


with TemporaryDirectory() as directory:
    path = Path(directory) / "manifest.txt"
    path.write_text("shipment-031\ninvalid row\n", encoding="utf-8")

    try:
        with path.open(encoding="utf-8") as manifest:
            assert manifest.readline().strip() == "shipment-031"
            raise ValueError("manifest could not be processed")
    except ValueError as error:
        assert str(error) == "manifest could not be processed"
        assert manifest.closed
    else:
        raise AssertionError("The processing error must propagate")
```

첫 줄이 `shipment-031`인지 확인한다. 처리 오류가 블록 밖으로 전달되는 시점에 `manifest.closed`가 참이다.

### 사례 2 — 여러 자원을 ExitStack에서 역순으로 정리

보고서 생성 요청에서 입력 파일 수가 실행 중에 정해진다. 각 파일이 열리는 즉시 `ExitStack`에 등록해, 나중 파일을 여는 데 실패해도 앞 파일을 마지막에 연 것부터 닫는다. Python 3.10 이상에서 표준 라이브러리와 로컬 임시 디렉터리를 사용한다.

```python
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TextIO


released: list[str] = []


@contextmanager
def open_input(path: Path) -> Iterator[TextIO]:
    with path.open(encoding="utf-8") as source:
        try:
            yield source
        finally:
            released.append(path.name)


with TemporaryDirectory() as directory:
    root = Path(directory)
    paths = [root / name for name in ("north.txt", "south.txt", "missing.txt")]
    for path in paths[:2]:
        path.write_text(path.stem, encoding="utf-8")

    opened: list[TextIO] = []
    try:
        with ExitStack() as stack:
            for path in paths:
                opened.append(stack.enter_context(open_input(path)))
    except FileNotFoundError:
        assert released == ["south.txt", "north.txt"]
        assert len(opened) == 2
        assert all(source.closed for source in opened)
    else:
        raise AssertionError("The missing input must abort the report")
```

세 번째 파일에서 진입이 실패한다. 앞서 등록된 두 파일의 정리 순서와 실제로 닫혔는지를 각각 확인한다.

### 사례 3 — 비동기 태스크가 취소되면 잠금 해제

예약 작업이 공유 자원을 사용하는 동안 태스크를 취소한다. `asynccontextmanager`의 `finally`에서 잠금을 해제해 다음 작업이 진입할 수 있게 한다. Python 3.11 이상에서 표준 `asyncio`를 사용한다.

```python
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager


@asynccontextmanager
async def reservation(lock: asyncio.Lock) -> AsyncIterator[None]:
    await lock.acquire()
    try:
        yield
    finally:
        lock.release()


async def main() -> None:
    lock = asyncio.Lock()
    entered = asyncio.Event()
    keep_running = asyncio.Event()

    async def run_reservation() -> None:
        async with reservation(lock):
            entered.set()
            await keep_running.wait()

    task = asyncio.create_task(run_reservation())
    async with asyncio.timeout(2):
        await entered.wait()
    assert lock.locked()

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        assert task.cancelled()
    else:
        raise AssertionError("Task cancellation must propagate")

    assert not lock.locked()
    async with reservation(lock):
        assert lock.locked()


asyncio.run(main())
```

`Event`로 확인한 진입 시점 이후에 취소한다. 태스크 취소는 호출자에게 그대로 전달되며 다음 블록이 같은 잠금을 얻는다. 이 예시의 `release()`에는 대기 지점이 없다. 정리 자체가 대기하는 연결이나 세션이라면 해당 API가 추가 취소 중 정리 완료를 어떻게 보장하는지 확인한다.

## 관련 문서

- 실행 전후에 계측을 추가하는 방식은 [Decorator](decorator.md)에서 다룬다.
- 일을 여러 단계로 나누고 입력의 수명을 관리하는 방식은 [Pipeline](pipeline.md)에서 다룬다.
- 스택에 등록한 정리 순서는 [Python `contextlib.ExitStack` 문서](https://docs.python.org/3.12/library/contextlib.html#contextlib.ExitStack)를 참고한다.
