# Adapter

## 목적

외부 SDK나 기존 구현을 호출하는 코드를 내부 계약과 연결한다. 어댑터가 데이터 형태, 메서드 이름, 값의 의미, 오류를 변환하면 소비자 코드에는 내부 계약만 남는다.

## 사용처

SDK가 반환하는 중첩 필드나 레거시 저장소의 센티널 값이 서비스 여러 곳에 반복될 때 쓴다. 기존 구현의 호출 규약과 의미가 내부 소비자에게 이미 맞으면 덕 타이핑으로 곧바로 주입할 수 있다.

## 장단점

외부 형식 변경의 영향 범위를 줄이고 테스트에서 SDK를 메모리 대역으로 바꿀 수 있다. 어댑터가 번역해야 할 필드와 오류가 많을수록 외부 버전 변경을 따라가는 비용이 늘어난다. 모호한 값을 임의로 보정하면 장애가 정상 결과처럼 보일 수 있다.

## 구현 방식

소비자 쪽에서 필요한 동작을 `Protocol`로 정의하고 어댑터에 외부 클라이언트나 저장소를 주입한다. 어댑터는 외부 호출 결과를 실행 중에 검증하고, 의미가 알려진 예외만 내부 예외로 변환한다. 타입 검사는 메서드 계약을 확인하는 데 쓴다. `@runtime_checkable`의 속성 존재 확인만으로는 메서드 서명이나 응답 필드 값을 검증할 수 없다.

## 예시

### 사례 1 — SDK 응답을 Protocol 소비자 계약으로 변환

배송 SDK 대역은 구조화된 응답에 예상 배송 시간을 분 단위로 반환한다. 화면은 내부 `DeliveryEstimates` 계약을 통해 정수만 받는다. Python 3.10 이상에서 동작하며, 선택적으로 mypy를 설치해 정적 계약도 확인할 수 있다.

```python
from typing import Protocol, TypedDict


class EstimatePayload(TypedDict):
    eta_minutes: int


class SdkResponse(TypedDict):
    estimate: EstimatePayload


class DeliverySdk(Protocol):
    def quote(self, postal_code: str, /) -> SdkResponse: ...


class DeliveryEstimates(Protocol):
    def minutes_for(self, postal_code: str, /) -> int: ...


class SdkEstimateAdapter:
    def __init__(self, sdk: DeliverySdk) -> None:
        self.sdk = sdk

    def minutes_for(self, postal_code: str, /) -> int:
        return self.sdk.quote(postal_code)["estimate"]["eta_minutes"]


class FakeDeliverySdk:
    def quote(self, postal_code: str, /) -> SdkResponse:
        assert postal_code == "04524"
        return {"estimate": {"eta_minutes": 45}}


def delivery_banner(estimates: DeliveryEstimates, postal_code: str) -> str:
    return f"Arrives in {estimates.minutes_for(postal_code)} minutes"


estimates: DeliveryEstimates = SdkEstimateAdapter(FakeDeliverySdk())
assert delivery_banner(estimates, "04524") == "Arrives in 45 minutes"
```

실행하면 배너가 `Arrives in 45 minutes`인지 확인한다. 선택적으로 이 파일을 `adapter_1.py`로 저장한 뒤 `python -m mypy --strict adapter_1.py`를 실행한다. 확인용 사본에서 어댑터의 `minutes_for` 반환 타입을 `str`로 바꾸고 구현도 문자열을 반환하게 수정하면, mypy가 `DeliveryEstimates`에 대한 대입을 거부한다.

### 사례 2 — 기존 저장소 메서드의 이름과 의미 연결

레거시 주소록은 사번을 찾고, 없으면 빈 문자열을 반환한다. 새 직원 검색은 사번이 없는 결과를 `None`으로 취급한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from typing import Protocol


class EmployeeDirectory(Protocol):
    def find_employee_id(self, email: str, /) -> str | None: ...


class LegacyAddressBook:
    def lookup_code(self, email: str) -> str:
        records = {"mina@example.org": "E-041"}
        return records.get(email, "")


class EmployeeDirectoryAdapter:
    def __init__(self, address_book: LegacyAddressBook) -> None:
        self.address_book = address_book

    def find_employee_id(self, email: str, /) -> str | None:
        code = self.address_book.lookup_code(email)
        return code if code != "" else None


directory: EmployeeDirectory = EmployeeDirectoryAdapter(LegacyAddressBook())
assert directory.find_employee_id("mina@example.org") == "E-041"
assert directory.find_employee_id("unknown@example.org") is None
```

기존 사번은 유지하고, 빈 문자열만 `None`으로 변환하는지 확인한다. 이름 변경과 결과 의미 변환을 한 메서드에서 함께 수행한다.

### 사례 3 — 누락된 필드와 외부 예외 매핑

센서 SDK 응답을 변환하는 경계에서 잘못된 데이터와 일시적인 접속 실패를 구분한다. Python 3.10 이상에서 표준 라이브러리만 사용하며 SDK 대신 함수 대역을 주입한다.

```python
from collections.abc import Callable, Mapping


class SdkTransportError(Exception):
    pass


class InvalidSensorReading(ValueError):
    pass


class SensorUnavailable(RuntimeError):
    pass


def read_celsius(fetch: Callable[[], Mapping[str, object]]) -> float:
    try:
        payload = fetch()
    except SdkTransportError as error:
        raise SensorUnavailable("sensor is unreachable") from error

    try:
        raw_value = payload["celsius"]
    except KeyError as error:
        raise InvalidSensorReading("missing celsius") from error

    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
        raise InvalidSensorReading("celsius must be a number")
    return float(raw_value)


def disconnected() -> Mapping[str, object]:
    raise SdkTransportError("connection lost")


assert read_celsius(lambda: {"celsius": -18}) == -18.0

try:
    read_celsius(lambda: {})
except InvalidSensorReading as error:
    assert isinstance(error.__cause__, KeyError)
else:
    raise AssertionError("A missing field must be rejected")

try:
    read_celsius(lambda: {"celsius": True})
except InvalidSensorReading:
    pass
else:
    raise AssertionError("A boolean field must be rejected")

try:
    read_celsius(disconnected)
except SensorUnavailable as error:
    assert isinstance(error.__cause__, SdkTransportError)
else:
    raise AssertionError("Transport failure must become SensorUnavailable")
```

필드가 누락되거나 값이 불리언이면 `InvalidSensorReading`이 발생한다. 연결이 끊기면 `SensorUnavailable`을 얻고 `__cause__`에서 SDK 예외를 확인할 수 있다.

## 관련 문서

- 도메인 데이터를 조회하고 저장하는 경계는 [Repository](repository.md)에서 다룬다.
- 소비자가 계약을 공유하는 방식을 확인하려면 [Python `typing.Protocol` 문서](https://docs.python.org/3.12/library/typing.html#typing.Protocol)를 참고한다.
