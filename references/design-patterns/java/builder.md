# Builder

## 목적

생성에 필요한 값을 단계별로 모으고 `build()`에서 객체의 불변 조건을 확인한다. 완성된 객체는 검증된 값만 보유한다.

## 사용처

여러 선택값을 조합하거나 서로 관련된 값을 함께 검증할 때 사용한다. 값이 적고 매개변수의 의미가 분명하면 생성자나 이름 있는 정적 팩토리로 충분하다.

## 장단점

호출부에 선택값의 이름이 드러나고 검증을 한곳에 모을 수 있다. 빌더에 가변 상태가 생기므로 빌더 재사용 시 기본값과 방어 복사를 관리해야 한다. 필수값의 누락은 일반적으로 빌드 시점에 발견된다.

## 구현 방식

중첩 `Builder`가 기본값과 선택값을 관리하고 `build()`가 필수값 및 값 사이의 제약을 검사한다. 완성된 객체의 생성자를 `private`으로 두면 다른 생성 경로에서도 검증을 우회할 수 없다. 가변 입력은 생성 시 복사하고, 요소도 가변이면 요소별로 복사하거나 불변 표현으로 바꾼다.

## 예시

### 사례 1 — 필수 호스트가 있는 클라이언트 설정

호스트는 필수이며 포트는 기본값 443을 사용한다. JDK 17 이상에서 `ClientSettings.java`로 저장해 `java -ea ClientSettings.java`를 실행한다.

```java
class ClientSettings {
    private final String host;
    private final int port;

    private ClientSettings(String host, int port) {
        this.host = host;
        this.port = port;
    }

    static class Builder {
        private String host;
        private int port = 443;

        Builder host(String value) {
            host = value;
            return this;
        }

        Builder port(int value) {
            port = value;
            return this;
        }

        ClientSettings build() {
            if (host == null || host.isBlank()) {
                throw new IllegalStateException("host is required");
            }
            if (port < 1 || port > 65_535) {
                throw new IllegalStateException("invalid port");
            }
            return new ClientSettings(host, port);
        }
    }

    public static void main(String[] args) {
        var settings = new Builder().host("example.test").build();
        assert settings.host.equals("example.test") && settings.port == 443;
        assert new Builder().host("example.test").port(8443).build().port == 8443;
        try {
            new Builder().build();
            throw new AssertionError("missing host accepted");
        } catch (IllegalStateException expected) {
            assert expected.getMessage().equals("host is required");
        }
        System.out.println("client settings ok");
    }
}
```

기본 포트와 명시한 포트를 각각 확인한다. 호스트를 생략하면 빌드가 실패하며 검증을 통과하면 `client settings ok`가 출력된다.

### 사례 2 — 옵션 목록을 방어 복사하는 검색 요청

검색 요청을 만들고 나서 호출자가 자기 옵션 목록을 수정해도 요청에는 생성 당시 값이 남아야 한다. JDK 17 이상에서 `SearchRequest.java`로 저장해 `java -ea SearchRequest.java`를 실행한다.

```java
import java.util.ArrayList;
import java.util.List;

class SearchRequest {
    private final List<String> options;

    private SearchRequest(List<String> options) {
        this.options = List.copyOf(options);
    }

    List<String> options() {
        return options;
    }

    static class Builder {
        private List<String> options = List.of();

        Builder options(List<String> value) {
            options = value;
            return this;
        }

        SearchRequest build() {
            return new SearchRequest(options);
        }
    }

    public static void main(String[] args) {
        var input = new ArrayList<>(List.of("recent"));
        var builder = new Builder().options(input);
        var first = builder.build();
        input.add("visible");
        assert first.options().equals(List.of("recent"));
        assert builder.build().options().equals(List.of("recent", "visible"));
        try {
            first.options().add("mutable");
            throw new AssertionError("mutable snapshot");
        } catch (UnsupportedOperationException expected) {
            assert first.options().size() == 1;
        }
        System.out.println("search snapshot ok");
    }
}
```

첫 요청은 `recent`만 보유하고, 두 번째 요청은 수정한 목록을 사용한다. 첫 요청의 목록을 직접 수정하면 예외가 발생하며 `search snapshot ok`가 출력된다.

### 사례 3 — 시작과 종료가 뒤바뀐 시간 범위 거절

조회 범위를 시작 시각 포함, 종료 시각 제외로 정의한다. 종료 시각은 시작 시각보다 뒤에 있어야 한다. JDK 17 이상에서 `TimeWindow.java`로 저장해 `java -ea TimeWindow.java`를 실행한다.

```java
import java.time.Instant;

class TimeWindow {
    private final Instant from;
    private final Instant until;

    private TimeWindow(Instant from, Instant until) {
        this.from = from;
        this.until = until;
    }

    boolean contains(Instant time) {
        return !time.isBefore(from) && time.isBefore(until);
    }

    static class Builder {
        private Instant from;
        private Instant until;

        Builder from(Instant value) {
            from = value;
            return this;
        }

        Builder until(Instant value) {
            until = value;
            return this;
        }

        TimeWindow build() {
            if (from == null || until == null || !from.isBefore(until)) {
                throw new IllegalStateException("from must precede until");
            }
            return new TimeWindow(from, until);
        }
    }

    public static void main(String[] args) {
        var start = Instant.parse("2024-04-10T00:00:00Z");
        var end = start.plusSeconds(60);
        var window = new Builder().from(start).until(end).build();
        assert window.contains(start) && !window.contains(end);
        for (var invalidEnd : new Instant[] {start, start.minusSeconds(1)}) {
            try {
                new Builder().from(start).until(invalidEnd).build();
                throw new AssertionError("invalid window accepted");
            } catch (IllegalStateException expected) {
                assert expected.getMessage().equals("from must precede until");
            }
        }
        System.out.println("window bounds ok");
    }
}
```

정상 범위는 시작 시각만 포함한다. 두 값이 같거나 종료가 시작보다 이르면 빌드가 실패하며 `window bounds ok`가 출력된다.

## 관련 문서

- [Factory](factory.md)는 완성된 객체의 구현 선택이나 자원 생성을 다룬다.
- [Java 17 `List.copyOf` API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection))
