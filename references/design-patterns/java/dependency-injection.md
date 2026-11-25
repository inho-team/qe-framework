# Dependency Injection

## 목적

서비스에 필요한 구현과 자원 수명을 조립 지점에서 결정한다. 서비스는 생성자로 받은 의존성의 계약에 따라 업무를 처리한다.

## 사용처

정책이나 저장소를 환경별로 교체하거나 여러 서비스의 자원 수명을 관리할 때 사용한다. 작은 프로그램에서는 호출부가 생성자를 직접 호출하는 방식으로 조립할 수 있다.

## 장단점

생성자에 의존성이 드러나고 단위 테스트에서 구현을 쉽게 교체할 수 있다. 컨테이너를 사용하면 어떤 빈이 연결되었는지 구성과 스코프를 함께 확인해야 한다. 긴 수명의 객체가 짧은 수명의 가변 상태를 보관하면 여러 요청이 그 상태를 공유할 수 있다.

## 구현 방식

필수 의존성은 생성자로 받아 필드에 보관한다. Spring에서는 기존 구성의 `@Bean` 메서드 인자로 의존성을 받고 컨테이너가 빈의 스코프와 해제를 관리하도록 한다. 웹 요청별 객체가 필요하면 Spring 웹 컨텍스트의 요청 스코프와 스코프 프록시를 쓰거나 요청의 진입점에서 값을 만들어 메서드 인자로 전달한다. 트랜잭션이 있는 프로젝트에서는 프록시를 거치는 호출 위치도 확인한다.

## 예시

### 사례 1 — 생성자로 정책 구현 전달

청구 서비스는 세율 정책을 생성자로 받는다. 같은 서비스에 운영 정책과 고정값을 반환하는 테스트 정책을 각각 전달한다. JDK 17 이상에서 `InvoiceService.java`로 저장해 `java -ea InvoiceService.java`를 실행한다.

```java
import java.util.Objects;

class InvoiceService {
    interface TaxPolicy {
        int taxOn(int cents);
    }

    private final TaxPolicy taxPolicy;

    InvoiceService(TaxPolicy taxPolicy) {
        this.taxPolicy = Objects.requireNonNull(taxPolicy);
    }

    int total(int subtotal) {
        return Math.addExact(subtotal, taxPolicy.taxOn(subtotal));
    }

    public static void main(String[] args) {
        var production = new InvoiceService(cents -> cents / 10);
        var test = new InvoiceService(cents -> 0);
        assert production.total(1_000) == 1_100;
        assert test.total(1_000) == 1_000;
        System.out.println("constructor injection ok");
    }
}
```

소계 1,000센트에 대해 운영 정책은 1,100센트, 테스트 정책은 1,000센트를 반환한다. 두 값을 검증하면 `constructor injection ok`가 출력된다.

### 사례 2 — Spring 구성에서 서비스 조립

Spring 구성 클래스에 메모리 저장소와 조회 서비스를 등록한다. 서비스와 저장소는 생성자로 연결하고, 구성 메서드가 저장소 빈을 인자로 받는다. JDK 17 이상과 Spring Framework 6.2.19를 사용한다. Maven 프로젝트 루트에 다음 `pom.xml`을 저장한다.

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId>
  <artifactId>spring-wiring</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-context</artifactId>
      <version>6.2.19</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
    </plugins>
  </build>
</project>
```

다음 코드를 `src/main/java/SpringWiring.java`로 저장하고 프로젝트 루트에서 `mvn compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java -Dexec.mainClass=SpringWiring`을 실행한다.

```java
import java.util.Map;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

public class SpringWiring {
    interface Customers {
        String name(String id);
    }

    record GreetingService(Customers customers) {
        String greet(String id) {
            return "Hello, " + customers.name(id);
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class Config {
        @Bean
        Customers customers() {
            return Map.of("42", "Ada")::get;
        }

        @Bean
        GreetingService greetingService(Customers customers) {
            return new GreetingService(customers);
        }
    }

    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            var service = context.getBean(GreetingService.class);
            if (!service.greet("42").equals("Hello, Ada")
                    || service.customers() != context.getBean(Customers.class)) {
                throw new AssertionError("Spring bean wiring failed");
            }
            System.out.println("spring wiring ok");
        }
    }
}
```

서비스가 `Hello, Ada`를 만들고 컨테이너와 같은 저장소 빈을 참조하면 `spring wiring ok`가 출력된다. 이 구성에서 빈 사이의 연결은 `@Bean` 인자로 표현한다. 컨텍스트는 `try` 블록을 나갈 때 닫힌다.

### 사례 3 — 요청별 객체와 싱글턴의 수명 경계

요청의 진입점이 요청마다 가변 추적 객체를 만들고 공유 서비스에 인자로 전달한다. 이 예시는 웹 컨테이너 없이 두 요청의 수명 경계를 확인한다. JDK 17 이상에서 `RequestLifetime.java`로 저장해 `java -ea RequestLifetime.java`를 실행한다.

```java
import java.util.ArrayList;
import java.util.List;

class RequestLifetime {
    static final class Trace {
        private final List<String> events = new ArrayList<>();

        void add(String event) {
            events.add(event);
        }

        List<String> snapshot() {
            return List.copyOf(events);
        }
    }

    static final class SharedService {
        void handle(String id, Trace requestTrace) {
            requestTrace.add("handled " + id);
        }
    }

    record Endpoint(SharedService shared) {
        Trace invoke(String id) {
            var trace = new Trace();
            shared.handle(id, trace);
            return trace;
        }
    }

    public static void main(String[] args) {
        var endpoint = new Endpoint(new SharedService());
        var first = endpoint.invoke("A");
        var second = endpoint.invoke("B");
        assert first != second;
        assert first.snapshot().equals(List.of("handled A"));
        assert second.snapshot().equals(List.of("handled B"));
        System.out.println("request isolation ok");
    }
}
```

하나의 서비스로 A와 B를 처리했을 때 서로 다른 추적 객체에 각 요청의 기록만 남는다. 검증을 통과하면 `request isolation ok`가 출력된다. Spring의 요청 스코프를 사용할 때에도 서로 다른 두 HTTP 요청으로 같은 격리 조건을 확인한다.

## 관련 문서

- [Factory](factory.md)는 구현과 자원을 어디서 생성할지 다룬다.
- [Strategy](strategy.md)는 생성자로 전달할 수 있는 정책의 계약을 다룬다.
- [Spring Framework 6.2 Java 기반 구성](https://docs.spring.io/spring-framework/reference/6.2/core/beans/java/basic-concepts.html)
- [Spring Framework 6.2 빈 스코프](https://docs.spring.io/spring-framework/reference/6.2/core/beans/factory-scopes.html)
