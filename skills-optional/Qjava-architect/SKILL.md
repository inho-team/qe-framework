---
name: Qjava-architect
description: Use when building, configuring, or debugging enterprise Java applications with Spring Boot 3.x, microservices, or reactive programming. Invoke to implement WebFlux endpoints, optimize JPA queries and database performance, configure Spring Security with OAuth2/JWT, or resolve authentication issues and async processing challenges in cloud-native Spring applications.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: Spring Boot, Java, microservices, Spring Cloud, JPA, Hibernate, WebFlux, reactive, Java Enterprise
role: architect
scope: implementation
output-format: code
related-skills: fullstack-guardian, api-designer, devops-engineer, database-optimizer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Java Architect

Enterprise Java specialist focused on Spring Boot 3.x, microservices architecture, and cloud-native development using Java 21 LTS.

## Core Workflow

1. **Architecture analysis** - Review project structure, dependencies, Spring config
2. **Domain design** - Create models following DDD and Clean Architecture; verify domain boundaries before proceeding. If boundaries are unclear, resolve ambiguities before moving to implementation.
3. **Implementation** - Build services with Spring Boot best practices
4. **Data layer** - Optimize JPA queries, implement repositories; run `./mvnw verify -pl <module>` to confirm query correctness. If integration tests fail: review Hibernate SQL logs, fix queries or mappings, re-run before proceeding.
5. **Security & config** - Apply Spring Security, externalize configuration, add observability; run `./mvnw verify` after security changes to confirm filter chain and JWT wiring. If tests fail: check `SecurityFilterChain` bean order and token validation config, then re-run.
6. **Quality assurance** - Run `./mvnw verify` (Maven) or `./gradlew check` (Gradle) to confirm all tests pass and coverage reaches 85%+ before closing. If coverage is below threshold: identify untested branches via JaCoCo report (`target/site/jacoco/index.html`), add missing test cases, re-run.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Spring Boot | `references/spring-boot-setup.md` | Project setup, configuration, starters |
| Reactive | `references/reactive-webflux.md` | WebFlux, Project Reactor, R2DBC |
| Data Access | `references/jpa-optimization.md` | JPA, Hibernate, query tuning |
| Security | `references/spring-security.md` | OAuth2, JWT, method security |
| Testing | `references/testing-patterns.md` | JUnit 5, TestContainers, Mockito |

## Constraints

### MUST DO
- Use Java 21 LTS features (records, sealed classes, pattern matching)
- Apply database migrations (Flyway/Liquibase)
- Document APIs with OpenAPI/Swagger
- Use proper exception handling hierarchy
- Externalize all configuration (never hardcode values)

### MUST NOT DO
- Use deprecated Spring APIs
- Skip input validation
- Store sensitive data unencrypted
- Use blocking code in reactive applications
- Ignore transaction boundaries

## Output Templates

When implementing Java features, provide:
1. Domain models (entities, DTOs, records)
2. Service layer (business logic, transactions)
3. Repository interfaces (Spring Data)
4. Controller/REST endpoints
5. Test classes with comprehensive coverage
6. Brief explanation of architectural decisions

## Code Examples

### Minimal WebFlux REST Endpoint

```java
@RestController
@RequestMapping("/api/v1/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    @GetMapping("/{id}")
    public Mono<ResponseEntity<OrderDto>> getOrder(@PathVariable UUID id) {
        return orderService.findById(id)
                .map(ResponseEntity::ok)
                .defaultIfEmpty(ResponseEntity.notFound().build());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<OrderDto> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        return orderService.create(request);
    }
}
```

### JPA Repository with Optimized Query

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {

    // Avoid N+1: fetch association in one query
    @Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.customerId = :customerId")
    List<Order> findByCustomerIdWithItems(@Param("customerId") UUID customerId);

    // Projection to limit fetched columns
    @Query("SELECT new com.example.dto.OrderSummary(o.id, o.status, o.total) FROM Order o WHERE o.status = :status")
    Page<OrderSummary> findSummariesByStatus(@Param("status") OrderStatus status, Pageable pageable);
}
```

### Spring Security OAuth2 JWT Configuration

```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
                .build();
    }
}
```

## Code Patterns

**Basic: Spring Service with @Service + Javadoc**
```java
/**
 * Order service providing business logic for order management.
 * 
 * @author Architecture Team
 * @since 1.0.0
 */
@Service
@RequiredArgsConstructor
public class OrderService {
    private final OrderRepository repository;
    
    /**
     * Retrieves an order by its unique identifier.
     * 
     * @param id the order ID
     * @return order if found
     * @throws OrderNotFoundException if order does not exist
     * @see OrderRepository#findById(Object)
     */
    public Order getOrder(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new OrderNotFoundException(id));
    }
}
```

**Error Handling: Custom Exception Hierarchy + @ExceptionHandler**
```java
public abstract class DomainException extends RuntimeException {}
public class OrderNotFoundException extends DomainException {}

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(OrderNotFoundException ex) {
        return ResponseEntity.notFound().build();
    }
}
```

**Advanced: Stream API + Optional Chaining**
```java
public List<OrderDto> getActiveOrders(UUID customerId) {
    return repository.findByCustomerId(customerId).stream()
            .filter(o -> o.getStatus() == OrderStatus.ACTIVE)
            .map(this::toDto)
            .toList();
}
```

## Comment Template

**Method Javadoc Format:**
```java
/**
 * Brief description.
 * 
 * @param paramName parameter description
 * @return return value description
 * @throws ExceptionType when this occurs
 * @see RelatedClass#method()
 */
```

**Class Javadoc Format:**
```java
/**
 * Purpose and responsibility of this class.
 * 
 * @author Team Name
 * @since 1.0.0
 */
```

**Package Javadoc:** Create `package-info.java`:
```java
/**
 * Order management domain package containing entities, repositories, and services.
 */
package com.example.order;
```

## Lint Rules

**Tools & Commands:**
- Checkstyle: `checkstyle -c /sun_checks.xml {file}` (config: `.checkstyle.xml`)
- SpotBugs: `./mvnw spotbugs:check` (config: `spotbugs-exclude.xml`)
- Full verification: `./mvnw verify` (includes tests + coverage)
- JaCoCo threshold: **85%+ code coverage** minimum

**Verify coverage:** `target/site/jacoco/index.html`

## Security Checklist

- **SQL Injection:** Use JPA/prepared statements; never concatenate user input into queries
- **XSS in Templates:** Enable auto-escaping in Thymeleaf/JSP; validate user input
- **Deserialization Attacks:** Avoid ObjectInputStream on untrusted data; use Jackson with `@JsonTypeInfo` whitelisting
- **CSRF Protection:** Spring Security enables by default; validate tokens on state-changing requests
- **Logging Secrets:** Mask sensitive fields (passwords, tokens, SSNs); use annotation-based redaction
- **Dependency Vulnerabilities:** Run `./mvnw org.owasp:dependency-check-maven:check` quarterly

## Anti-patterns

| **Wrong** | **Correct** |
|-----------|-----------|
| God service class (handles multiple domains) | Split by domain: OrderService, PaymentService, ShippingService |
| Checked exception abuse (`throws Exception`) | Use runtime exceptions; catch and wrap at boundaries |
| Field injection (`@Autowired private X x;`) | Constructor injection; enables testing and immutability |
| Raw types (`List list = new ArrayList();`) | Use generics: `List<Order> orders = new ArrayList<>();` |
| Synchronized methods everywhere | Use concurrent collections: `ConcurrentHashMap`, `CopyOnWriteArrayList` |

## Knowledge Reference

Spring Boot 3.x, Java 21, Spring WebFlux, Project Reactor, Spring Data JPA, Spring Security, OAuth2/JWT, Hibernate, R2DBC, Spring Cloud, Resilience4j, Micrometer, JUnit 5, TestContainers, Mockito, Maven/Gradle
