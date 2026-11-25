# Factory

## 목적

구현 선택과 자원 생성 절차를 호출부에서 한곳으로 옮긴다. 호출부는 생성된 객체의 공통 계약과 자원 해제 시점에 집중한다.

## 사용처

설정에 따라 영수증 형식이 달라지거나 외부 자원 연결을 생성할 때 사용한다. 구현 하나의 생성자가 필요한 인자를 모두 표현하면 직접 생성으로 충분하다.

## 장단점

생성 규칙과 오류를 한곳에서 바꿀 수 있고 자원 공급자를 테스트 대역으로 교체할 수 있다. 등록 누락은 실행할 때 드러날 수 있고, 설정과 팩토리가 떨어져 있으면 어떤 구현을 만드는지 추적하기 어려울 수 있다.

## 구현 방식

간단한 선택은 정적 팩토리의 `switch`에서 처리하고, 외부 자원 생성은 의존성 조립 지점에서 공급자를 전달한다. 성공한 호출에서 누가 `close()`를 호출하는지 정한다. 생성 중 실패하면 팩토리가 아직 넘기지 않은 자원을 정리하고, 열기 실패와 지원하지 않는 종류를 구분한다.

## 예시

### 사례 1 — 설정에 따라 영수증 인코더 선택

영수증 출력 형식을 설정에서 읽고 두 형식에 같은 정수 금액을 전달한다. JDK 17 이상에서 `ReceiptEncoders.java`로 저장해 `java -ea ReceiptEncoders.java`를 실행한다.

```java
class ReceiptEncoders {
    interface Encoder {
        String encode(int cents);
    }

    static Encoder create(String format) {
        return switch (format) {
            case "text" -> cents -> "total=" + cents;
            case "json" -> cents -> "{\"total\":" + cents + "}";
            default -> throw new IllegalArgumentException("unknown format: " + format);
        };
    }

    public static void main(String[] args) {
        assert create("text").encode(700).equals("total=700");
        assert create("json").encode(700).equals("{\"total\":700}");
        System.out.println("encoders ok");
    }
}
```

금액 700을 텍스트와 JSON의 각 형식으로 인코딩한 뒤 `encoders ok`가 출력된다.

### 사례 2 — 외부 자원을 생성하는 공급자 조립

조립 지점에서 파일을 여는 공급자를 선택한다. 처리 코드는 공급자가 연 `BufferedReader`를 사용하고 닫는다. JDK 17 이상에서 `ReceiptSource.java`로 저장해 `java -ea ReceiptSource.java`를 실행한다.

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;

class ReceiptSource {
    interface ReaderProvider {
        BufferedReader open() throws IOException;
    }

    static ReaderProvider fileProvider(Path path) {
        return () -> Files.newBufferedReader(path);
    }

    static String header(ReaderProvider provider) throws IOException {
        try (var reader = provider.open()) {
            return reader.readLine();
        }
    }

    public static void main(String[] args) throws IOException {
        var path = Files.createTempFile("receipt", ".txt");
        try {
            Files.writeString(path, "id,total\n42,700\n");
            assert header(fileProvider(path)).equals("id,total");
            assert header(() -> new BufferedReader(new StringReader("test header")))
                    .equals("test header");
        } finally {
            Files.delete(path);
        }
        System.out.println("reader provider ok");
    }
}
```

파일과 메모리 공급자를 같은 처리 코드에 전달한다. 두 소스에서 각 헤더를 읽고 임시 파일까지 정리하면 `reader provider ok`가 출력된다.

### 사례 3 — 미등록 종류와 생성 중 실패 처리

등록된 공급자는 연결을 연 뒤 초기화한다. 초기화가 실패하면 팩토리가 연결을 닫고 원래 예외를 넘긴다. 메모리 연결로 이 경계를 확인한다. JDK 17 이상에서 `ConnectionFactory.java`로 저장해 `java -ea ConnectionFactory.java`를 실행한다.

```java
import java.io.IOException;
import java.util.Map;
import java.util.function.Supplier;

class ConnectionFactory {
    static class Connection implements AutoCloseable {
        private final IOException startupFailure;
        private int closes;

        Connection(IOException startupFailure) {
            this.startupFailure = startupFailure;
        }

        void initialize() throws IOException {
            if (startupFailure != null) {
                throw startupFailure;
            }
        }

        @Override
        public void close() {
            closes++;
        }
    }

    static Connection create(Map<String, Supplier<Connection>> providers, String kind)
            throws IOException {
        var provider = providers.get(kind);
        if (provider == null) {
            throw new IllegalArgumentException("unknown connection: " + kind);
        }
        var connection = provider.get();
        try {
            connection.initialize();
            return connection;
        } catch (IOException | RuntimeException failure) {
            try {
                connection.close();
            } catch (RuntimeException closeFailure) {
                failure.addSuppressed(closeFailure);
            }
            throw failure;
        }
    }

    public static void main(String[] args) throws IOException {
        var failure = new IOException("initialization failed");
        var broken = new Connection(failure);
        var healthy = new Connection(null);
        Map<String, Supplier<Connection>> providers = Map.of(
                "broken", () -> broken, "healthy", () -> healthy);
        try {
            create(providers, "missing");
            throw new AssertionError("unknown kind accepted");
        } catch (IllegalArgumentException expected) {
            assert broken.closes == 0 && healthy.closes == 0;
        }
        try {
            create(providers, "broken");
            throw new AssertionError("initialization failure lost");
        } catch (IOException expected) {
            assert expected == failure && broken.closes == 1;
        }
        try (var connection = create(providers, "healthy")) {
            assert connection == healthy && healthy.closes == 0;
        }
        assert healthy.closes == 1;
        System.out.println("factory ownership ok");
    }
}
```

미등록 종류는 `IllegalArgumentException`을 일으킨다. 초기화 실패는 같은 `IOException`을 전달하고 연결을 한 번 닫는다. 성공한 연결은 호출자가 닫으며 `factory ownership ok`가 출력된다. 실제 공급자에서 연결을 열다가 실패하면 아직 반환하지 않은 자원은 그 공급자가 정리한다.

## 관련 문서

- [Builder](builder.md)는 선택값을 모으고 생성할 값의 제약을 확인한다.
- [Dependency Injection](dependency-injection.md)은 생성한 구현과 수명을 서비스의 조립 지점에서 관리한다.
