# Adapter

## 목적

공급자 SDK나 기존 API를 도메인의 타입과 오류 계약에 맞춘다. 외부 표현을 한 클래스나 메서드에서 변환해 도메인 호출부에는 업무상 필요한 정보만 전달한다.

## 사용처

외부 API의 필드, 단위 또는 오류가 내부 모델과 다르거나 그 변환을 여러 곳에서 쓰게 될 때 사용한다. 한 호출부에서 값 하나를 변환하면 짧은 메서드로 충분하다.

## 장단점

공급자 표현이 바뀌어도 도메인의 수정 범위를 줄일 수 있고 외부 호출 없이 변환을 시험할 수 있다. 필드나 오류를 빠뜨리면 호출부가 판단에 필요한 정보를 잃으므로 공급자 계약을 대조하고 경계를 검증해야 한다.

## 구현 방식

도메인에서 원하는 인터페이스를 정의하고 어댑터에서 기존 API를 호출한다. 성공 응답과 누락을 명시적으로 변환하고, 시간 초과와 재시도 가능 오류에 대한 정보를 보존한다. 재시도 여부는 작업의 중복 실행 가능성을 아는 호출자가 판단하도록 둔다.

## 예시

### 사례 1 — 공급자 응답을 도메인 영수증으로 변환

공급자 응답의 소수 통화 금액과 거래 ID를 도메인의 정수 센트와 영수증 ID로 바꾼다. 공급자는 메모리 람다로 대체한다. JDK 17 이상에서 `ReceiptAdapter.java`로 저장해 `java -ea ReceiptAdapter.java`를 실행한다.

```java
import java.math.BigDecimal;

class ReceiptAdapter {
    record VendorSale(String transaction, String amountUsd) {}
    record Receipt(String id, long cents) {}

    interface Vendor {
        VendorSale transaction(String id);
    }

    interface Receipts {
        Receipt find(String id);
    }

    record VendorReceipts(Vendor vendor) implements Receipts {
        public Receipt find(String id) {
            var sale = vendor.transaction(id);
            long cents = new BigDecimal(sale.amountUsd()).movePointRight(2).longValueExact();
            return new Receipt(sale.transaction(), cents);
        }
    }

    public static void main(String[] args) {
        Receipts receipts = new VendorReceipts(id -> new VendorSale(id, "12.50"));
        assert receipts.find("r-7").equals(new Receipt("r-7", 1_250));
        System.out.println("receipt mapping ok");
    }
}
```

`12.50` 달러는 정확히 1,250센트로 변환되며 `receipt mapping ok`가 출력된다. `longValueExact()`는 센트 미만의 값이나 `long` 범위를 넘는 값을 거절한다.

### 사례 2 — 기존 날짜 API와 도메인 시간대 연결

기존 API가 주는 `Date`의 시점을 매장의 영업일로 바꾼다. JVM 기본 시간대에 따라 날짜가 달라지지 않도록 매장 시간대를 주입한다. JDK 17 이상에서 `BusinessDateAdapter.java`로 저장해 `java -ea BusinessDateAdapter.java`를 실행한다.

```java
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.function.Supplier;

class BusinessDateAdapter {
    record BusinessCalendar(Supplier<Date> legacyClock, ZoneId zone) {
        LocalDate today() {
            return LocalDate.ofInstant(legacyClock.get().toInstant(), zone);
        }
    }

    public static void main(String[] args) {
        var instant = Instant.parse("2024-04-10T23:30:00Z");
        Supplier<Date> clock = () -> Date.from(instant);
        var utc = new BusinessCalendar(clock, ZoneId.of("UTC"));
        var seoul = new BusinessCalendar(clock, ZoneId.of("Asia/Seoul"));
        assert utc.today().equals(LocalDate.of(2024, 4, 10));
        assert seoul.today().equals(LocalDate.of(2024, 4, 11));
        System.out.println("business dates ok");
    }
}
```

같은 시점이 UTC에서는 4월 10일, 서울에서는 4월 11일이 된다. 날짜가 모두 맞으면 `business dates ok`가 출력된다.

### 사례 3 — 시간 초과와 결과 없음 구분

기존 API는 정상 조회에서 결과가 없으면 `null`을 반환하고, 시간 초과 시 `SocketTimeoutException`을 던진다. 도메인에서는 누락을 `Optional.empty()`로 표현하고 시간 초과는 원인을 담은 예외로 전달한다. JDK 17 이상에서 `LookupAdapter.java`로 저장해 `java -ea LookupAdapter.java`를 실행한다.

```java
import java.net.SocketTimeoutException;
import java.util.Optional;

class LookupAdapter {
    interface LegacyLookup {
        String find(String id) throws SocketTimeoutException;
    }

    static class LookupTimedOut extends RuntimeException {
        LookupTimedOut(String id, Throwable cause) {
            super("lookup timed out: " + id, cause);
        }
    }

    record Directory(LegacyLookup legacy) {
        Optional<String> find(String id) {
            try {
                return Optional.ofNullable(legacy.find(id));
            } catch (SocketTimeoutException failure) {
                throw new LookupTimedOut(id, failure);
            }
        }
    }

    public static void main(String[] args) {
        assert new Directory(id -> "Ada").find("42").orElseThrow().equals("Ada");
        assert new Directory(id -> null).find("42").isEmpty();
        var timeout = new SocketTimeoutException("read timed out");
        try {
            new Directory(id -> { throw timeout; }).find("42");
            throw new AssertionError("timeout lost");
        } catch (LookupTimedOut expected) {
            assert expected.getCause() == timeout;
        }
        System.out.println("lookup outcomes ok");
    }
}
```

이름, 빈 결과, 원래 시간 초과를 원인으로 보유한 예외가 서로 구분되며 `lookup outcomes ok`가 출력된다.

## 관련 문서

- [Decorator](decorator.md)는 같은 인터페이스를 유지하며 호출 전후 동작을 추가한다.
- [Java 17 `Date.toInstant` API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Date.html#toInstant())
