# Strategy

## 목적

배송 요금이나 배정 기준처럼 바뀌는 알고리즘을 호출 흐름에서 분리한다. 호출부가 입력 검증과 결과 사용을 담당하고, 전략이 계산이나 선택을 담당한다.

## 사용처

요금, 검증 또는 정렬 정책을 설정이나 고객 유형에 따라 바꿔야 할 때 사용한다. 규칙 하나가 고정되어 있거나 조건이 한 곳에서만 쓰이면 메서드나 `switch`로 충분하다.

## 장단점

같은 호출부로 여러 정책을 시험할 수 있다. 전략마다 입력 범위, 결과의 단위, 오류 계약이 어긋나면 교체할 때 호출부의 동작도 바뀐다. 이름과 계약을 정하고 정책별 경계값을 검증하는 비용이 든다.

## 구현 방식

연산 하나는 JDK 함수형 인터페이스나 `@FunctionalInterface`와 람다로 표현한다. 여러 연산이 공통 규칙을 지켜야 하면 이름 있는 인터페이스에 묶는다. 호출부의 생성자에서 전략을 받거나 요청의 설정 키로 전략을 고른다. 입력과 결과의 공통 제약은 호출부에서 검사한다.

## 예시

### 사례 1 — 배송 요금 계산

배송 서비스가 무게를 그램으로 받고 요금을 원으로 반환한다. 표준 배송과 특급 배송의 계산식만 다르므로 `IntUnaryOperator`로 전달한다. JDK 17 이상에서 `ShippingRates.java`로 저장해 `java -ea ShippingRates.java`를 실행한다.

```java
import java.util.function.IntUnaryOperator;

class ShippingRates {
    record ShippingService(IntUnaryOperator rate) {
        int quote(int grams) {
            if (grams < 1 || grams > 20_000) {
                throw new IllegalArgumentException("weight outside 1..20000 g");
            }
            return rate.applyAsInt(grams);
        }
    }

    public static void main(String[] args) {
        var standard = new ShippingService(grams -> 2_000 + grams);
        var express = new ShippingService(grams -> 4_000 + grams * 2);
        assert standard.quote(500) == 2_500;
        assert express.quote(500) == 5_000;
        System.out.println("shipping ok");
    }
}
```

같은 500g 입력에 대해 표준은 2,500원, 특급은 5,000원을 반환하며 `shipping ok`가 출력된다.

### 사례 2 — 창고별 배정 규칙 교체

창고의 배정 규칙에 재고 적격 여부와 우선순위라는 두 연산이 필요하다. 운영 코드는 두 연산을 `AllocationRule`에서 받아 같은 후보 목록에 적용한다. JDK 17 이상에서 `WarehouseAllocation.java`로 저장해 `java -ea WarehouseAllocation.java`를 실행한다.

```java
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

class WarehouseAllocation {
    record Bin(String id, int stock, int distance) {}

    interface AllocationRule {
        boolean eligible(Bin bin, int units);
        Comparator<Bin> priority();
    }

    record StockRule(Comparator<Bin> priority) implements AllocationRule {
        @Override
        public boolean eligible(Bin bin, int units) {
            return bin.stock() >= units;
        }
    }

    static Optional<Bin> allocate(List<Bin> bins, int units, AllocationRule rule) {
        return bins.stream()
                .filter(bin -> rule.eligible(bin, units))
                .min(rule.priority().thenComparing(Bin::id));
    }

    public static void main(String[] args) {
        var bins = List.of(new Bin("A", 3, 1), new Bin("B", 8, 4), new Bin("C", 20, 8));
        var nearest = new StockRule(Comparator.comparingInt(Bin::distance));
        var largest = new StockRule(Comparator.comparingInt(Bin::stock).reversed());
        assert allocate(bins, 4, nearest).orElseThrow().id().equals("B");
        assert allocate(bins, 4, largest).orElseThrow().id().equals("C");
        assert allocate(bins, 21, nearest).isEmpty();
        System.out.println("allocation ok");
    }
}
```

가까운 창고를 우선하면 B, 재고가 많은 창고를 우선하면 C가 선택된다. 21개를 요청하면 결과가 비어 있고 `allocation ok`가 출력된다.

### 사례 3 — 지원하지 않는 요금제와 금액 범위 검증

할인은 주문 금액을 초과하거나 음수일 수 없다. 계산기는 요금제 조회와 공통 범위 검증을 맡는다. JDK 17 이상에서 `PlanValidation.java`로 저장해 `java -ea PlanValidation.java`를 실행한다.

```java
import java.util.Map;
import java.util.function.IntUnaryOperator;

class PlanValidation {
    static int total(Map<String, IntUnaryOperator> plans, String plan, int subtotal) {
        if (subtotal < 0) {
            throw new IllegalArgumentException("negative subtotal");
        }
        var discount = plans.get(plan);
        if (discount == null) {
            throw new IllegalArgumentException("unknown plan: " + plan);
        }
        int amount = discount.applyAsInt(subtotal);
        if (amount < 0 || amount > subtotal) {
            throw new IllegalStateException("discount outside 0..subtotal");
        }
        return subtotal - amount;
    }

    public static void main(String[] args) {
        Map<String, IntUnaryOperator> plans = Map.of(
                "half", cents -> cents / 2,
                "free", cents -> cents,
                "broken", cents -> -1);
        assert total(plans, "half", 0) == 0;
        assert total(plans, "free", 100) == 0;
        try {
            total(plans, "missing", 100);
            throw new AssertionError("unknown plan accepted");
        } catch (IllegalArgumentException expected) {
            assert expected.getMessage().equals("unknown plan: missing");
        }
        try {
            total(plans, "broken", 100);
            throw new AssertionError("invalid discount accepted");
        } catch (IllegalStateException expected) {
            assert expected.getMessage().equals("discount outside 0..subtotal");
        }
        System.out.println("plan bounds ok");
    }
}
```

할인이 0 또는 주문 금액과 같으면 계산이 성공한다. 미등록 요금제는 `IllegalArgumentException`, 계약을 어긴 할인 구현은 `IllegalStateException`으로 구분되며 `plan bounds ok`가 출력된다.

## 관련 문서

- [Factory](factory.md)는 입력에 맞는 구현을 생성하거나 고르는 지점을 설명한다.
- [Dependency Injection](dependency-injection.md)은 선택한 전략을 서비스에 전달하는 방법을 설명한다.
