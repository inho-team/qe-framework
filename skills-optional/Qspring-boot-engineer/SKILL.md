---
name: Qspring-boot-engineer
description: Generates Spring Boot 3.x configurations, creates REST controllers, implements Spring Security 6 authentication flows, sets up Spring Data JPA repositories, and configures reactive WebFlux endpoints. Use when building Spring Boot 3.x applications, microservices, or reactive Java applications; invoke for Spring Data JPA, Spring Security 6, WebFlux, Spring Cloud integration, Java REST API design, or Microservices Java architecture.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: backend
triggers: Spring Boot, Spring Framework, Spring Cloud, Spring Security, Spring Data JPA, Spring WebFlux, Microservices Java, Java REST API, Reactive Java
role: specialist
scope: implementation
output-format: code
related-skills: java-architect, database-optimizer, microservices-architect, devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Spring Boot Engineer

## Core Workflow

1. **Analyze requirements** — Identify service boundaries, APIs, data models, security needs
2. **Design architecture** — Plan microservices, data access, cloud integration, security; confirm design before coding
3. **Implement** — Create services with constructor injection and layered architecture (see Quick Start below)
4. **Secure** — Add Spring Security, OAuth2, method security, CORS configuration; verify security rules compile and pass tests. If compilation or tests fail: review error output, fix the failing rule or configuration, and re-run before proceeding
5. **Test** — Write unit, integration, and slice tests; run `./mvnw test` (or `./gradlew test`) and confirm all pass before proceeding. If tests fail: review the stack trace, isolate the failing assertion or component, fix the issue, and re-run the full suite
6. **Deploy** — Configure health checks and observability via Actuator; validate `/actuator/health` returns `UP`. If health is `DOWN`: check the `components` detail in the response, resolve the failing component (e.g., datasource, broker), and re-validate

## References

For detailed patterns, see: `references/{web,data,security,cloud,testing}.md`

## Code Patterns — Spring Boot Examples with Javadoc

### Basic: @RestController + @Service

```java
/** REST endpoint delegating to ProductService. */
@RestController @RequestMapping("/api/v1/products")
public class ProductController {
    private final ProductService service;
    public ProductController(ProductService service) { this.service = service; }
    /** @param name search term; @return matching products */
    @GetMapping
    public List<Product> search(@RequestParam(defaultValue = "") String name) {
        return service.search(name);
    }
}

/** Business logic managing transactions and repository calls. */
@Service
public class ProductService {
    private final ProductRepository repo;
    public ProductService(ProductRepository repo) { this.repo = repo; }
    /** @param name filter; @return matching products */
    @Transactional(readOnly = true)
    public List<Product> search(String name) {
        return repo.findByNameContainingIgnoreCase(name);
    }
}
```

### Error Handling: @ControllerAdvice + ResponseEntity

```java
/** Centralized REST exception handler. */
@RestControllerAdvice
public class GlobalExceptionHandler {
    /** @param ex binding error; @return 400 with field errors */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String,String>> handleValidation(
            MethodArgumentNotValidException ex) {
        var errors = ex.getBindingResult().getFieldErrors().stream()
            .collect(Collectors.toMap(FieldError::getField, FieldError::getDefaultMessage));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errors);
    }
    /** @param ex not found; @return 404 with message */
    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<Map<String,String>> handleNotFound(EntityNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }
}
```

### Advanced: WebFlux Reactive Endpoint

```java
/** Reactive REST endpoint returning Mono/Flux. */
@RestController @RequestMapping("/api/v1/reactive/orders")
public class OrderFluxController {
    private final OrderService service;
    public OrderFluxController(OrderService service) { this.service = service; }
    /** @param id order id; @return Mono<Order> or empty */
    @GetMapping("/{id}")
    public Mono<ResponseEntity<Order>> getOrder(@PathVariable Long id) {
        return service.findById(id).map(ResponseEntity::ok)
            .defaultIfEmpty(ResponseEntity.notFound().build());
    }
    /** @return Flux of all orders */
    @GetMapping
    public Flux<Order> listOrders() { return service.findAll(); }
}
```

## Comment Template — Javadoc

```java
/** [One-line purpose]. [Optional: additional context].
 * @param paramName [description]
 * @return [description]
 * @throws ExceptionType [when/why]
 */
```

## Lint Rules

```bash
./mvnw checkstyle:check  # Google style; fail on violations
./mvnw spotbugs:check     # Null, resource leaks, bugs
./mvnw clean verify       # Full build + JaCoCo ≥ 85% coverage
```

## Security Checklist

- [ ] Spring Security: `@EnableWebSecurity` + `@Bean SecurityFilterChain`
- [ ] CSRF enabled (Spring Security default; verify WebFlux)
- [ ] SQL injection prevented: JPA parameterized queries (no JPQL concatenation)
- [ ] XSS mitigated: Content Security Policy headers; escape template output
- [ ] CORS explicit: `@CrossOrigin` or `WebMvcConfigurer`; never `allowCredentials=true` with `*`
- [ ] Actuator secured: `/actuator/health` public, others require `ACTUATOR` role
- [ ] Dependency scan: `./mvnw dependency-check:check` monthly; pin/upgrade patches

## Anti-patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `@Autowired private Repo r;` | `public Service(Repo r) { this.r = r; }` |
| `catch (Exception e) {}` | `catch (SpecificException e)` or propagate to @ControllerAdvice |
| 50-method God Service | Split: AuthService, CacheService, ProductService |
| No `@Transactional` on writes | Add `@Transactional`; use `readOnly=true` for reads |
| `System.getenv("DB_PW")` hardcoded | Use `@Value` or `@ConfigurationProperties` + env vars |

## Constraints

### MUST DO
- Constructor injection (no `@Autowired` on fields)
- `@Valid` + `@RequestBody` on every mutating endpoint
- `@Transactional` on multi-step writes; `@Transactional(readOnly = true)` on reads
- Use `@Service`/`@Repository`/`@RestController` (not generic `@Component`)
- Global exception handler (`@RestControllerAdvice`) for API errors
- Externalize secrets via environment variables or Spring Cloud Config

### MUST NOT DO
- Field injection (`@Autowired` on fields)
- Hardcode credentials, URLs, or profile-specific values
- Mix blocking and reactive code (e.g., `.block()` in WebFlux)
- Store secrets in `application.properties`/`application.yml`
- Use deprecated Spring Boot 2.x patterns (`WebSecurityConfigurerAdapter`)
