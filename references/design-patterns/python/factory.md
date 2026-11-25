# Factory

## 목적

외부 입력으로부터 적절한 구현을 선택하고, 객체가 사용할 값과 의존성을 조립한다. 생성 규칙을 한곳에 두면 소비자는 생성된 객체가 제공하는 기능을 사용한다.

## 사용처

파일 형식, 배포 환경, 설정 등에 따라 같은 계약의 구현을 골라야 할 때 쓴다. 같은 클래스에 검증된 인자를 전달하는 일만 필요하면 생성자를 직접 호출하는 편이 간단하다.

## 장단점

외부 문자열, 기본값, 구현 선택을 한 경계에서 관리할 수 있고 생성 실패를 객체 사용 전에 발견할 수 있다. 팩토리가 호출되는 시점을 감추거나 무거운 연결 작업까지 맡으면 테스트와 자원 수명 관리가 어려워진다. 설정을 변환하는 팩토리와 실제 연결을 열고 닫는 작업의 책임을 명확히 한다.

## 구현 방식

여러 구현을 고르는 경우 모듈 함수에 선택 정책을 둔다. 같은 클래스에 이름 있는 생성 경로가 필요하면 `classmethod`에서 외부 값을 확인하고 `cls(...)`를 호출한다. 데이터 클래스의 리스트나 딕셔너리 기본값은 `field(default_factory=...)`로 인스턴스를 만들 때 호출해 얻는다.

## 예시

### 사례 1 — 입력 종류별 객체 생성

보고서 내보내기가 JSON 뒤에 개행을 붙이는 형식과 TSV 형식을 지원한다. 모듈 팩토리가 외부 옵션을 읽어 같은 `Exporter` 계약을 제공하는 구현을 반환한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
import json
from typing import Protocol


class Exporter(Protocol):
    def render(self, report_id: str, count: int, /) -> str: ...


class JsonExporter:
    def render(self, report_id: str, count: int, /) -> str:
        return json.dumps({"id": report_id, "count": count}) + "\n"


class TsvExporter:
    def render(self, report_id: str, count: int, /) -> str:
        if any(separator in report_id for separator in ("\t", "\r", "\n")):
            raise ValueError("report id contains a TSV separator")
        return f"{report_id}\t{count}\n"


def make_exporter(format_name: str) -> Exporter:
    if format_name == "json":
        return JsonExporter()
    if format_name == "tsv":
        return TsvExporter()
    raise ValueError(f"unsupported report format: {format_name}")


assert json.loads(make_exporter("json").render("daily", 4)) == {
    "id": "daily",
    "count": 4,
}
assert make_exporter("tsv").render("daily", 4) == "daily\t4\n"

try:
    make_exporter("pdf")
except ValueError as error:
    assert str(error) == "unsupported report format: pdf"
else:
    raise AssertionError("Unknown formats must be rejected")
```

두 구현을 같은 `render` 호출로 사용한다. `assert`로 JSON을 역직렬화한 결과, TSV 행, 지원하지 않는 형식의 오류를 확인한다.

### 사례 2 — classmethod에서 외부 값을 검증해 조립

예약 알림 작업의 설정 맵은 대기 시간을 문자열로 전달한다. 이름 있는 생성 메서드에서 키 누락, 숫자 변환 실패와 범위 초과를 처리한다. Python 3.11 이상에서 표준 라이브러리만 사용한다.

```python
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Self


@dataclass(frozen=True)
class Reminder:
    lead_minutes: int

    def __post_init__(self) -> None:
        if not 1 <= self.lead_minutes <= 120:
            raise ValueError("lead time must be between 1 and 120 minutes")

    @classmethod
    def from_config(cls, config: Mapping[str, str]) -> Self:
        try:
            value = config["lead_minutes"]
        except KeyError as error:
            raise ValueError("lead_minutes is required") from error
        try:
            minutes = int(value)
        except ValueError as error:
            raise ValueError("lead_minutes must be an integer") from error
        return cls(lead_minutes=minutes)


assert Reminder.from_config({"lead_minutes": "30"}) == Reminder(30)

for config, message in [
    ({}, "lead_minutes is required"),
    ({"lead_minutes": "tomorrow"}, "lead_minutes must be an integer"),
    ({"lead_minutes": "0"}, "lead time must be between 1 and 120 minutes"),
]:
    try:
        Reminder.from_config(config)
    except ValueError as error:
        assert str(error) == message
    else:
        raise AssertionError("Invalid configuration must be rejected")
```

`from_config`가 문자열을 정수로 바꾸고, 생성자는 호출 경로와 관계없이 대기 시간 범위를 검증한다. 정상 설정과 오류 세 종류의 결과를 확인한다.

### 사례 3 — default_factory로 가변 상태의 공유 방지

검수 요청마다 별도의 이슈 목록을 유지해야 한다. `default_factory=list`가 기본 인자를 생략한 인스턴스마다 새 목록을 생성한다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from dataclasses import dataclass, field


@dataclass
class Review:
    shipment_id: str
    issues: list[str] = field(default_factory=list)


north = Review("shipment-110")
south = Review("shipment-111")
assert north.issues is not south.issues

north.issues.append("missing label")
assert north.issues == ["missing label"]
assert south.issues == []

existing = ["weight discrepancy"]
resumed = Review("shipment-112", issues=existing)
assert resumed.issues is existing
```

한 요청에 이슈를 추가해도 다른 요청의 목록은 비어 있다. 인자로 명시한 목록은 그대로 사용하므로 복사나 소유권 이전이 필요한 호출은 이를 별도로 처리한다.

## 관련 문서

- 객체 사용 중에 정책을 교체하는 방식은 [Strategy](strategy.md)에서 다룬다.
- 생성된 객체가 소유한 연결의 수명 관리는 [Context Manager](context-manager.md)에서 다룬다.
- 기본값을 만드는 호출 규약은 [Python `dataclasses.field` 문서](https://docs.python.org/3.12/library/dataclasses.html#dataclasses.field)를 참고한다.
