# Observer

## 목적

상태 변화나 프레임워크 이벤트를 여러 수신자에게 알린다. 발행자는 어떤 변화가 언제 일어났는지 표현하고, 수신자는 집계나 로그처럼 그 변화에 반응하는 작업을 맡는다.

## 사용처

같은 프로세스에서 서로 독립적인 소비자가 도메인 변경을 받아야 하거나, 프레임워크가 이미 신호로 확장 지점을 제공할 때 쓴다. 발행 코드가 반드시 성공 여부를 확인해야 할 작업 한 가지에는 직접 호출이 흐름과 실패를 분명하게 보여 준다.

## 장단점

발행자는 수신자의 구현을 몰라도 되므로 구독을 추가하기 쉽다. 구독이 어디에서 등록되는지, 실행 순서가 어떻게 결정되는지 찾을 비용이 생긴다. 동기 수신자의 지연은 발행 경로에도 영향을 주고, 전역 등록은 테스트 간 중복 구독이나 객체의 수명 연장으로 이어질 수 있다.

## 구현 방식

이벤트의 필드와 발행 시점을 먼저 정한다. 커밋된 데이터에 대한 이벤트라면 커밋이 성공한 뒤 발행한다. 콜백 구현에서는 구독이 끝날 때 호출할 해제 함수를 두고, 프레임워크 신호를 쓰는 경우 프레임워크의 참조 수명과 중복 등록 방지 규약을 따른다. 수신자 오류가 발생했을 때 발행을 중단할지, 오류를 기록하고 다른 수신자를 계속 실행할지 정한다.

## 예시

### 사례 1 — 콜백으로 도메인 변경 알림

온실 목표 온도가 실제로 바뀔 때 화면과 감사 로그가 같은 변경 이벤트를 받는다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class SetpointChanged:
    previous: int
    current: int


class Greenhouse:
    def __init__(self, setpoint: int) -> None:
        self.setpoint = setpoint
        self.receivers: list[Callable[[SetpointChanged], None]] = []

    def subscribe(self, receive: Callable[[SetpointChanged], None]) -> None:
        self.receivers.append(receive)

    def set_target(self, degrees: int) -> None:
        if degrees == self.setpoint:
            return
        event = SetpointChanged(self.setpoint, degrees)
        self.setpoint = degrees
        for receive in tuple(self.receivers):
            receive(event)


greenhouse = Greenhouse(18)
display: list[int] = []
audit: list[SetpointChanged] = []
greenhouse.subscribe(lambda event: display.append(event.current))
greenhouse.subscribe(audit.append)

greenhouse.set_target(20)
greenhouse.set_target(20)

assert greenhouse.setpoint == 20
assert display == [20]
assert audit == [SetpointChanged(18, 20)]
```

상태가 갱신된 뒤 두 수신자가 변경을 한 번씩 받는다. 같은 값으로 다시 설정했을 때 발행하지 않는지 확인한다.

### 사례 2 — 프레임워크 신호에 집계 작업 구독

Django 신호에 체크아웃 완료 금액을 더하는 수신자를 연결한다. 이 예시는 독립 신호에 이벤트를 직접 보내며 별도 Django 프로젝트나 DB가 필요 없다. Python 3.10 이상과 Django 5.2가 필요하다. 격리된 환경에서 `python -m pip install "Django>=5.2,<5.3"`으로 설치한다.

```python
from django.dispatch import Signal


class Checkout:
    pass


class Refund:
    pass


checkout_completed = Signal()
amounts: list[int] = []


def aggregate_checkout(sender: type, *, amount_cents: int, **extra: object) -> None:
    amounts.append(amount_cents)


dispatch_uid = "metrics.checkout_total"
checkout_completed.connect(aggregate_checkout, sender=Checkout, dispatch_uid=dispatch_uid)
checkout_completed.connect(aggregate_checkout, sender=Checkout, dispatch_uid=dispatch_uid)

try:
    checkout_completed.send(sender=Checkout, amount_cents=1_200)
    checkout_completed.send(sender=Checkout, amount_cents=350)
    checkout_completed.send(sender=Refund, amount_cents=1_200)
    assert amounts == [1_200, 350]
    assert sum(amounts) == 1_550
finally:
    checkout_completed.disconnect(sender=Checkout, dispatch_uid=dispatch_uid)
```

같은 `dispatch_uid`와 발행자로 두 번 등록해도 한 번만 집계한다. 체크아웃 이벤트 두 건만 반영되고 환불 발행자는 필터링되는지 확인한다. `finally`에서 구독을 해제해 실행마다 수신자 등록을 정리한다.

### 사례 3 — 구독 해제와 수신자 오류의 전파 확인

재고 동기화 이벤트를 받는 첫 수신자가 실패하면 발행자가 오류를 얻고 후속 수신자는 이번 알림을 받지 않는다. 실패한 수신자를 해제한 다음 발행할 때는 남은 수신자가 실행된다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Callable


class InventoryNotifications:
    def __init__(self) -> None:
        self.receivers: dict[object, Callable[[str], None]] = {}

    def subscribe(self, receive: Callable[[str], None]) -> Callable[[], None]:
        token = object()
        self.receivers[token] = receive

        def unsubscribe() -> None:
            self.receivers.pop(token, None)

        return unsubscribe

    def publish(self, sku: str) -> None:
        for receive in tuple(self.receivers.values()):
            receive(sku)


def update_cache(sku: str) -> None:
    raise OSError(f"cache update failed: {sku}")


notifications = InventoryNotifications()
delivered: list[str] = []
stop_cache_updates = notifications.subscribe(update_cache)
stop_audit_updates = notifications.subscribe(delivered.append)

try:
    notifications.publish("SKU-17")
except OSError as error:
    assert str(error) == "cache update failed: SKU-17"
else:
    raise AssertionError("Receiver failure must reach the publisher")
assert delivered == []

stop_cache_updates()
stop_cache_updates()
notifications.publish("SKU-18")
assert delivered == ["SKU-18"]

stop_audit_updates()
notifications.publish("SKU-19")
assert delivered == ["SKU-18"]
```

첫 수신자의 오류가 발행자에게 전달되고 다음 수신자의 실행이 중단된다. 같은 해제 함수를 두 번 호출해도 안전하며, 모든 구독을 해제하면 더 이상 전달 기록이 생기지 않는다. 발행 시점의 수신자 목록을 스냅샷으로 복사하므로 발행 중에 구독이 바뀌면 다음 발행부터 반영된다.

## 관련 문서

- 수신자처럼 등록한 자원의 종료 범위를 보장하는 방식은 [Context Manager](context-manager.md)에서 다룬다.
- 이전 단계의 결과를 이어서 소비하는 방식은 [Pipeline](pipeline.md)에서 다룬다.
- Django의 `dispatch_uid`, `send()`와 `send_robust()`의 동작은 [Django 5.2 신호 문서](https://docs.djangoproject.com/en/5.2/topics/signals/)를 참고한다.
