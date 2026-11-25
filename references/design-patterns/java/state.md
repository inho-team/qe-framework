# State

## 목적

객체가 현재 상태에서 할 수 있는 동작과 전이 후 보유할 데이터를 코드에 명시한다. 전이 메서드가 허용 여부를 판단하고 호출부는 그 결과를 사용한다.

## 사용처

같은 명령의 결과가 현재 상태에 따라 달라지고 금지 전이가 생길 때 사용한다. 표시용 상태만 저장하고 전이 규칙이 없으면 값이나 `enum`으로 충분하다.

## 장단점

전이 제약을 한곳에서 확인할 수 있다. 상태별로 타입을 나누면 각 상태에서 유효한 데이터만 표현할 수 있지만 타입 수가 늘어난다. 상태를 저장했다가 읽는 시스템은 예전 표현과의 호환성을 관리해야 한다.

## 구현 방식

단순 전이는 `enum`과 전이 메서드로 표현한다. 상태마다 필요한 데이터가 다르고 대상 JDK가 지원하면 `sealed` 인터페이스와 `record`로 타입을 구분한다. 금지 전이에서 객체가 그대로 유지되는지 시험한다. 저장 형식은 내부 타입명과 분리하고, 알려진 과거 값을 명시적으로 읽는다.

## 예시

### 사례 1 — 주문 접수와 배송 전이

새 주문을 접수한 다음에만 배송 처리할 수 있다. JDK 17 이상에서 `OrderFlow.java`로 저장해 `java -ea OrderFlow.java`를 실행한다.

```java
class OrderFlow {
    enum Status { NEW, ACCEPTED, SHIPPED }

    static class Order {
        private Status status = Status.NEW;

        void accept() {
            move(Status.NEW, Status.ACCEPTED);
        }

        void ship() {
            move(Status.ACCEPTED, Status.SHIPPED);
        }

        private void move(Status from, Status to) {
            if (status != from) {
                throw new IllegalStateException(status + " cannot move to " + to);
            }
            status = to;
        }
    }

    public static void main(String[] args) {
        var order = new Order();
        assert order.status == Status.NEW;
        order.accept();
        assert order.status == Status.ACCEPTED;
        order.ship();
        assert order.status == Status.SHIPPED;
        System.out.println("order shipped");
    }
}
```

주문 상태가 `NEW`, `ACCEPTED`, `SHIPPED` 순으로 바뀌며 `order shipped`가 출력된다.

### 사례 2 — 상태마다 데이터가 다른 문서 승인

초안은 본문을 보유한다. 제출 상태에는 제출자가, 승인 상태에는 승인자가 추가로 필요하다. JDK 17 이상에서 `DocumentApproval.java`로 저장해 `java -ea DocumentApproval.java`를 실행한다.

```java
class DocumentApproval {
    sealed interface Document permits Draft, Submitted, Approved {}

    record Draft(String body) implements Document {
        Submitted submit(String author) {
            return new Submitted(body, author);
        }
    }

    record Submitted(String body, String author) implements Document {
        Approved approve(String reviewer) {
            if (author.equals(reviewer)) {
                throw new IllegalArgumentException("reviewer must differ from author");
            }
            return new Approved(body, author, reviewer);
        }
    }

    record Approved(String body, String author, String reviewer) implements Document {}

    public static void main(String[] args) {
        var draft = new Draft("Budget");
        var submitted = draft.submit("Ada");
        var approved = submitted.approve("Lin");
        assert submitted.equals(new Submitted("Budget", "Ada"));
        assert approved.equals(new Approved("Budget", "Ada", "Lin"));
        System.out.println("document approved");
    }
}
```

제출 뒤에는 제출자가, 승인 뒤에는 승인자가 함께 보존된다. 전이 결과가 맞으면 `document approved`가 출력된다. 초안에 직접 `approve()`를 호출하면 컴파일러가 그 호출을 거절한다.

### 사례 3 — 취소 뒤 확정 거절과 기존 상태값 읽기

이전 버전이 저장한 `VOID`를 새 버전의 취소 상태로 읽는다. 취소된 예약은 확정할 수 없으며 다시 저장할 때는 새 형식인 `cancelled`를 쓴다. JDK 17 이상에서 `BookingState.java`로 저장해 `java -ea BookingState.java`를 실행한다.

```java
class BookingState {
    enum Status {
        PENDING("pending"), CONFIRMED("confirmed"), CANCELLED("cancelled");

        private final String storageKey;

        Status(String storageKey) {
            this.storageKey = storageKey;
        }

        static Status read(String stored) {
            return switch (stored) {
                case "pending" -> PENDING;
                case "confirmed" -> CONFIRMED;
                case "cancelled", "VOID" -> CANCELLED;
                default -> throw new IllegalArgumentException("unknown state: " + stored);
            };
        }
    }

    record Booking(Status status) {
        Booking confirm() {
            if (status != Status.PENDING) {
                throw new IllegalStateException("only pending bookings can be confirmed");
            }
            return new Booking(Status.CONFIRMED);
        }
    }

    public static void main(String[] args) {
        var cancelled = new Booking(Status.read("VOID"));
        assert cancelled.status() == Status.read("cancelled");
        assert cancelled.status().storageKey.equals("cancelled");
        try {
            cancelled.confirm();
            throw new AssertionError("cancelled booking confirmed");
        } catch (IllegalStateException expected) {
            assert cancelled.status() == Status.CANCELLED;
        }
        try {
            Status.read("unknown");
            throw new AssertionError("unknown state read");
        } catch (IllegalArgumentException expected) {
            assert expected.getMessage().equals("unknown state: unknown");
        }
        assert new Booking(Status.PENDING).confirm().status() == Status.CONFIRMED;
        System.out.println("booking compatibility ok");
    }
}
```

`VOID`와 `cancelled`는 모두 취소 상태로 읽히고, 취소 뒤에 확정해도 상태가 유지된다. 알려지지 않은 상태값은 읽을 때 거절되며 `booking compatibility ok`가 출력된다.

## 관련 문서

- [Strategy](strategy.md)는 같은 동작을 수행할 정책을 선택하는 구조를 다룬다.
- [Java 17 언어 업데이트의 Sealed Classes](https://docs.oracle.com/en/java/javase/17/language/sealed-classes-and-interfaces.html)
