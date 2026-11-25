# Decorator

## 목적

저장소나 서비스의 인터페이스를 유지하면서 호출 전후에 계측이나 캐시를 추가한다. 원래 구현은 도메인 동작을 담당하고 래퍼는 추가 동작을 담당한다.

## 사용처

같은 부가 동작을 여러 구현에 적용하거나 래퍼의 적용 순서를 조립 지점에서 바꿀 때 사용한다. 한 곳에만 필요한 로그라면 해당 호출 주변의 계측으로 충분하다.

## 장단점

래퍼를 구현별로 복제하지 않고 조합할 수 있다. 순서에 따라 계측 대상이나 캐시 적중 동작이 달라지고, 호출 횟수와 예외 및 트랜잭션 경계가 바뀔 수 있다. 캐시가 메모리를 점유하고 값의 신선도를 관리할 책임도 생긴다.

## 구현 방식

원래 구현과 같은 인터페이스를 구현하고 생성자에서 위임 대상을 받는다. 예외와 반환값의 의미를 보존하고, 호출 횟수를 바꾸는 캐시는 계약이 허용하는 읽기에 적용한다. Spring AOP에서 대상 객체의 자기 호출은 프록시를 지나지 않으므로 계측이나 트랜잭션이 필요한 경로가 프록시를 통과하는지 확인한다.

## 예시

### 사례 1 — 저장소 호출 소요 시간 측정

저장소를 호출하는 시간만 측정한다. 실제 실행 시간에 기대지 않도록 테스트에서 고정된 두 시각을 제공한다. JDK 17 이상에서 `TimedRepository.java`로 저장해 `java -ea TimedRepository.java`를 실행한다.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.function.LongConsumer;
import java.util.function.LongSupplier;

class TimedRepository {
    interface Repository {
        String read(String id);
    }

    record Timed(Repository delegate, LongSupplier ticks, LongConsumer elapsed)
            implements Repository {
        public String read(String id) {
            long start = ticks.getAsLong();
            try {
                return delegate.read(id);
            } finally {
                elapsed.accept(ticks.getAsLong() - start);
            }
        }
    }

    public static void main(String[] args) {
        var times = List.of(100L, 140L).iterator();
        var samples = new ArrayList<Long>();
        Repository repository = new Timed(id -> "name-" + id, times::next, samples::add);
        assert repository.read("7").equals("name-7");
        assert samples.equals(List.of(40L));
        System.out.println("timing ok");
    }
}
```

저장소는 기존 값 `name-7`을 반환하고 측정값 40을 한 번 기록한다. 두 값이 맞으면 `timing ok`가 출력된다. 운영에서는 `System::nanoTime`을 시계로 넘기고, 기록 코드가 예외를 던질 수 있으면 사례 3처럼 원래 실패를 보존한다.

### 사례 2 — 같은 계약을 유지하는 캐시 래퍼

읽기 전용 카탈로그 스냅샷의 조회 결과를 캐시한다. 등록되지 않은 ID는 빈 결과로 표현하므로 `Optional.empty()`도 캐시할 수 있다. 이 예시는 단일 스레드에서 사용한다. JDK 17 이상에서 `CachedCatalog.java`로 저장해 `java -ea CachedCatalog.java`를 실행한다.

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

class CachedCatalog {
    interface Catalog {
        Optional<String> find(String id);
    }

    static class Cached implements Catalog {
        private final Catalog delegate;
        private final Map<String, Optional<String>> results = new HashMap<>();

        Cached(Catalog delegate) {
            this.delegate = delegate;
        }

        public Optional<String> find(String id) {
            return results.computeIfAbsent(id, delegate::find);
        }
    }

    public static void main(String[] args) {
        var calls = new AtomicInteger();
        Catalog catalog = new Cached(id -> {
            calls.incrementAndGet();
            return Optional.ofNullable(Map.of("7", "notebook").get(id));
        });
        for (int attempt = 0; attempt < 2; attempt++) {
            assert catalog.find("7").orElseThrow().equals("notebook");
            assert catalog.find("missing").isEmpty();
        }
        assert calls.get() == 2;
        System.out.println("cache contract ok");
    }
}
```

같은 두 ID를 두 번씩 조회해도 저장소는 ID마다 한 번만 호출된다. 반환값과 빈 결과를 확인하면 `cache contract ok`가 출력된다. 카탈로그가 갱신되면 스냅샷에 맞춰 캐시를 교체하거나 무효화한다.

### 사례 3 — 원래 예외와 호출 횟수 보존

주문 저장은 한 번만 시도한다. 실패 감사 기록까지 예외를 던지면 원래 저장 실패를 그대로 전달하고 기록 실패는 보조 예외로 남긴다. JDK 17 이상에서 `AuditedOrders.java`로 저장해 `java -ea AuditedOrders.java`를 실행한다.

```java
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

class AuditedOrders {
    interface Orders {
        void save(String id) throws IOException;
    }

    record Audited(Orders delegate, Consumer<String> onFailure) implements Orders {
        public void save(String id) throws IOException {
            try {
                delegate.save(id);
            } catch (IOException original) {
                try {
                    onFailure.accept(id);
                } catch (RuntimeException auditFailure) {
                    original.addSuppressed(auditFailure);
                }
                throw original;
            }
        }
    }

    public static void main(String[] args) {
        var writes = new AtomicInteger();
        var audits = new AtomicInteger();
        var diskFailure = new IOException("disk full");
        var auditFailure = new IllegalStateException("audit unavailable");
        Orders orders = new Audited(id -> {
            writes.incrementAndGet();
            throw diskFailure;
        }, id -> {
            audits.incrementAndGet();
            throw auditFailure;
        });
        try {
            orders.save("o-7");
            throw new AssertionError("write failure lost");
        } catch (IOException expected) {
            assert expected == diskFailure;
            assert expected.getSuppressed().length == 1;
            assert expected.getSuppressed()[0] == auditFailure;
        }
        assert writes.get() == 1 && audits.get() == 1;
        System.out.println("exception and call count ok");
    }
}
```

저장과 감사 기록을 각각 한 번 시도하며 호출자는 원래 `IOException`을 받는다. 보조 예외도 확인하면 `exception and call count ok`가 출력된다.

## 관련 문서

- [Adapter](adapter.md)는 외부 API를 다른 인터페이스에 맞춘다.
- [Spring Framework 6.2 AOP 프록시](https://docs.spring.io/spring-framework/reference/6.2/core/aop/proxying.html)
