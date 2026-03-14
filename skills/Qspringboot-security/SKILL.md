---
name: Qspringboot-security
description: "Spring Security best practices guide. Use for security-related tasks in Java Spring Boot services: authentication/authorization, input validation, CSRF, secrets management, security headers, rate limiting, and dependency security."
metadata:
  source: https://skills.sh/affaan-m/everything-claude-code/springboot-security
  author: affaan-m
---
> Shared principles: see core/PRINCIPLES.md


# Spring Boot Security Review

Use when adding authentication, handling input, creating endpoints, or managing secrets.

## When to Activate

- Adding authentication (JWT, OAuth2, session-based)
- Implementing authorization (@PreAuthorize, role-based access)
- Validating user input (Bean Validation, custom validators)
- Configuring CORS, CSRF, security headers
- Managing secrets (Vault, environment variables)
- Rate limiting, brute-force protection
- Scanning dependencies for CVEs

## Authentication

- Prefer stateless JWT or opaque tokens with a revocation list
- Use `httpOnly`, `Secure`, `SameSite=Strict` cookies for sessions
- Validate tokens with `OncePerRequestFilter`

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
  private final JwtService jwtService;

  public JwtAuthFilter(JwtService jwtService) {
    this.jwtService = jwtService;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain chain) throws ServletException, IOException {
    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (header != null && header.startsWith("Bearer ")) {
      String token = header.substring(7);
      Authentication auth = jwtService.authenticate(token);
      SecurityContextHolder.getContext().setAuthentication(auth);
    }
    chain.doFilter(request, response);
  }
}
```

## Authorization

- Enable `@EnableMethodSecurity`
- Use `@PreAuthorize("hasRole('ADMIN')")` or `@PreAuthorize("@authz.canEdit(#id)")`
- Default deny; expose only required scope

```java
@PreAuthorize("hasRole('ADMIN')")
@GetMapping("/users")
public List<UserDto> listUsers() { return userService.findAll(); }

@PreAuthorize("@authz.isOwner(#id, authentication)")
@DeleteMapping("/users/{id}")
public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
  userService.delete(id);
  return ResponseEntity.noContent().build();
}
```

## Input Validation

- Use Bean Validation + `@Valid`
- Apply constraints on DTOs: `@NotBlank`, `@Email`, `@Size`

```java
public record CreateUserDto(
    @NotBlank @Size(max = 100) String name,
    @NotBlank @Email String email,
    @NotNull @Min(0) @Max(150) Integer age
) {}

@PostMapping("/users")
public ResponseEntity<UserDto> createUser(@Valid @RequestBody CreateUserDto dto) {
  return ResponseEntity.status(HttpStatus.CREATED).body(userService.create(dto));
}
```

## SQL Injection Prevention

```java
// BAD: string concatenation
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// GOOD: parameter binding
@Query(value = "SELECT * FROM users WHERE name = :name", nativeQuery = true)
List<User> findByName(@Param("name") String name);

// GOOD: Spring Data derived query
List<User> findByEmailAndActiveTrue(String email);
```

## Password Encoding

```java
@Bean
public PasswordEncoder passwordEncoder() {
  return new BCryptPasswordEncoder(12);
}
```

## CSRF Protection

- Browser session apps: enable CSRF
- Pure API (Bearer token): disable CSRF

```java
http.csrf(csrf -> csrf.disable())
    .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
```

## Secrets Management

```yaml
# BAD: hardcoded
spring:
  datasource:
    password: mySecretPassword123

# GOOD: environment variable
spring:
  datasource:
    password: ${DB_PASSWORD}
```

## Security Headers

```java
http.headers(headers -> headers
    .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'"))
    .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin)
    .xssProtection(Customizer.withDefaults()));
```

## CORS Configuration

- Configure CORS at the security filter level
- Never use `*` in production

```java
@Bean
public CorsConfigurationSource corsConfigurationSource() {
  CorsConfiguration config = new CorsConfiguration();
  config.setAllowedOrigins(List.of("https://app.example.com"));
  config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
  config.setAllowCredentials(true);
  UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
  source.registerCorsConfiguration("/api/**", config);
  return source;
}
```

## Rate Limiting

- Use Bucket4j or gateway-level limiting
- Return 429 + retry hint

## Checklist Before Release

- [ ] Auth token validation and expiry checked
- [ ] Authorization guards on all sensitive endpoints
- [ ] All inputs validated and sanitized
- [ ] No string-concatenated SQL
- [ ] CSRF config matches app type
- [ ] Secrets externalized; none committed
- [ ] Security headers configured
- [ ] API rate limiting in place
- [ ] Dependencies scanned and up to date
- [ ] No sensitive data in logs

**Core principle**: default deny, validate inputs, least privilege, prefer config-driven security.
