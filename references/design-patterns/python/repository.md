# Repository

## 목적

유스케이스가 도메인 객체와 식별자로 데이터를 조회하고 저장할 수 있게 한다. Repository는 DB 쿼리, ORM 레코드 변환, 저장소 오류 해석을 맡고, 서비스는 비즈니스 규칙과 한 작업에 포함할 변경 범위를 결정한다.

## 사용처

여러 유스케이스가 저장된 객체를 같은 의미로 조회하거나, 구현을 메모리 대역으로 바꿔 서비스 로직을 검증할 때 쓴다. 조회 결과를 그대로 화면에 표시하는 간단한 코드에서는 프로젝트의 ORM 조회를 직접 호출해도 충분할 수 있다.

## 장단점

서비스를 저장 기술과 분리해 순수한 단위 테스트를 작성할 수 있고, 조회의 의미를 일관되게 유지할 수 있다. ORM 모델과 도메인 객체 사이를 매핑하는 코드가 추가된다. 모든 쿼리를 범용 인터페이스로 감싸면 필터, 일괄 조회, 사전 로딩 요구가 가려져 쿼리 수와 비용을 파악하기 어렵다.

## 구현 방식

소비자 쪽에서 조회와 저장에 필요한 계약을 정의한다. ORM 구현은 쿼리를 실행해 도메인 객체를 구성하고, 메모리 대역에도 조회 실패와 변경 동작의 의미를 맞춘다. 여러 쓰기를 하나로 묶을 때는 유스케이스가 트랜잭션을 열고, 각 저장소 메서드는 그 범위 안에서 쓰기를 수행한다. 조회 계약에서 부재를 `None`으로 표현한다면 연결, 제약, 권한 등의 실패는 별도 예외로 유지한다.

## 예시

### 사례 1 — 메모리 구현으로 저장소 경계 테스트

도서 대여 상태를 바꾸는 서비스에 메모리 저장소를 주입한다. 이 대역은 도메인 객체를 불변으로 보관하므로 저장을 거치지 않은 변경이 테스트를 통과하는 일을 막는다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from dataclasses import dataclass, replace
from typing import Protocol


@dataclass(frozen=True)
class Book:
    isbn: str
    loaned: bool = False


class Books(Protocol):
    def get(self, isbn: str, /) -> Book | None: ...
    def save(self, book: Book, /) -> None: ...


class InMemoryBooks:
    def __init__(self, initial: list[Book]) -> None:
        self.rows = {book.isbn: book for book in initial}

    def get(self, isbn: str, /) -> Book | None:
        return self.rows.get(isbn)

    def save(self, book: Book, /) -> None:
        self.rows[book.isbn] = book


def lend(books: Books, isbn: str) -> bool:
    book = books.get(isbn)
    if book is None or book.loaned:
        return False
    books.save(replace(book, loaned=True))
    return True


original = Book("978-0-306-40615-7")
books = InMemoryBooks([original])

assert lend(books, original.isbn) is True
assert books.get(original.isbn) == Book(original.isbn, loaned=True)
assert original.loaned is False
assert lend(books, original.isbn) is False
assert lend(books, "missing") is False
```

첫 대여만 상태를 저장한다. 원본 객체의 값과 저장된 값을 각각 확인하고, 중복 요청과 잘못된 식별자가 대여로 처리되지 않는지도 확인한다.

### 사례 2 — ORM의 도메인 모델과 트랜잭션 경계 관리

서로 다른 가판대 사이의 재고 이동은 두 쓰기가 함께 성공해야 한다. 저장소는 Django 레코드와 불변 도메인 모델을 변환하고, 재고 이동 함수는 두 쓰기에 하나의 트랜잭션을 적용한다. Python 3.10 이상과 Django 5.2가 필요하다. 격리된 환경에서 `python -m pip install "Django>=5.2,<5.3"`으로 설치한다. 코드는 별도 프로젝트 설정 없이 메모리 SQLite에서 실행한다.

```python
from dataclasses import dataclass, replace
from typing import Protocol

import django
from django.conf import settings
from django.db import connection, models, transaction

settings.configure(
    INSTALLED_APPS=[],
    DATABASES={
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    },
)
django.setup()


class StockRow(models.Model):
    stall = models.CharField(max_length=20, primary_key=True)
    units = models.PositiveIntegerField()

    class Meta:
        app_label = "inventory"


@dataclass(frozen=True)
class Stock:
    stall: str
    units: int


class StockRepository(Protocol):
    def get(self, stall: str) -> Stock: ...
    def save(self, stock: Stock) -> None: ...


class DjangoStock:
    def get(self, stall: str) -> Stock:
        row = StockRow.objects.get(pk=stall)
        return Stock(row.stall, row.units)

    def save(self, stock: Stock) -> None:
        changed = StockRow.objects.filter(pk=stock.stall).update(units=stock.units)
        if changed != 1:
            raise LookupError(stock.stall)


def move(stock: StockRepository, source: str, target: str, units: int) -> None:
    if units <= 0 or source == target:
        raise ValueError("expected distinct stalls and a positive amount")

    with transaction.atomic():
        outgoing = stock.get(source)
        incoming = stock.get(target)
        if outgoing.units < units:
            raise ValueError("insufficient units")
        stock.save(replace(outgoing, units=outgoing.units - units))
        if incoming.units + units > 10:
            raise OverflowError("target stall capacity exceeded")
        stock.save(replace(incoming, units=incoming.units + units))


with connection.schema_editor() as schema:
    schema.create_model(StockRow)

StockRow.objects.bulk_create([
    StockRow(stall="east", units=5),
    StockRow(stall="west", units=6),
])
stock = DjangoStock()
move(stock, "east", "west", 3)
assert (stock.get("east"), stock.get("west")) == (Stock("east", 2), Stock("west", 9))

try:
    move(stock, "east", "west", 2)
except OverflowError:
    pass
else:
    raise AssertionError("The capacity error was expected")

assert (stock.get("east"), stock.get("west")) == (Stock("east", 2), Stock("west", 9))
connection.close()
```

첫 이동은 두 레코드에 반영된다. 두 번째 이동은 출발지 쓰기 후에 가판대 수용량 오류가 발생하므로, 트랜잭션이 첫 쓰기도 되돌리고 이전 재고를 유지하는지 확인한다. 여러 요청이 같은 재고를 동시에 바꾸는 시스템에서는 잠금이나 조건부 갱신을 저장소 계약에 포함하고, 운영 DB에서 동작을 확인한다.

### 사례 3 — 사용자 없음과 저장소 실패 구분

인사 서비스의 환영 문구가 사용자 없음, 표시 이름 있음, 저장소 실패를 각각 다룬다. Python 3.10 이상에서 표준 라이브러리만 사용한다.

```python
from typing import Protocol


class ProfilesUnavailable(RuntimeError):
    pass


class Profiles(Protocol):
    def display_name_for(self, user_id: str, /) -> str | None: ...


class MemoryProfiles:
    def display_name_for(self, user_id: str, /) -> str | None:
        return {"u-10": "Mina"}.get(user_id)


class UnavailableProfiles:
    def display_name_for(self, user_id: str, /) -> str | None:
        raise ProfilesUnavailable("directory connection closed")


def greeting(profiles: Profiles, user_id: str) -> str:
    name = profiles.display_name_for(user_id)
    return "Welcome" if name is None else f"Welcome, {name}"


assert greeting(MemoryProfiles(), "u-10") == "Welcome, Mina"
assert greeting(MemoryProfiles(), "unknown") == "Welcome"

try:
    greeting(UnavailableProfiles(), "u-10")
except ProfilesUnavailable as error:
    assert str(error) == "directory connection closed"
else:
    raise AssertionError("Storage failure must reach the caller")
```

존재하는 사용자는 이름이 포함된 문구를, 존재하지 않는 사용자는 일반 문구를 받는다. 저장소 실패 때는 호출자가 `ProfilesUnavailable`을 받아 공통 오류 처리나 재시도 정책을 적용할 수 있다.

## 관련 문서

- 외부 모델과 오류를 내부 계약에 맞추는 방식은 [Adapter](adapter.md)에서 다룬다.
- 블록 종료 시 자원 정리를 관리하는 방식은 [Context Manager](context-manager.md)에서 다룬다.
- 예외에 따른 롤백 범위는 [Django 5.2 트랜잭션 문서](https://docs.djangoproject.com/en/5.2/topics/db/transactions/#controlling-transactions-explicitly)를 참고한다.
