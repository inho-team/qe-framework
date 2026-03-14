---
name: Qspringboot-security
description: "Spring Security 모범 사례 가이드. 인증/인가, 입력 검증, CSRF, 시크릿 관리, 보안 헤더, Rate Limiting, 의존성 보안 등 Java Spring Boot 서비스의 보안 관련 작업에 사용합니다."
metadata:
  source: https://skills.sh/affaan-m/everything-claude-code/springboot-security
  author: affaan-m
---
> 공통 원칙: core/PRINCIPLES.md 참조


# Spring Boot Security Review

인증, 입력 처리, 엔드포인트 생성, 시크릿 관리 시 사용합니다.

## When to Activate

- 인증 추가 (JWT, OAuth2, 세션 기반)
- 인가 구현 (@PreAuthorize, 역할 기반 접근)
- 사용자 입력 검증 (Bean Validation, 커스텀 검증기)
- CORS, CSRF, 보안 헤더 설정
- 시크릿 관리 (Vault, 환경 변수)
- Rate Limiting, 브루트포스 방지
- 의존성 CVE 스캔

## Authentication

- 상태 비저장 JWT 또는 취소 목록이 있는 불투명 토큰 선호
- 세션에는 `httpOnly`, `Secure`, `SameSite=Strict` 쿠키 사용
- `OncePerRequestFilter`로 토큰 검증

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

- `@EnableMethodSecurity` 활성화
- `@PreAuthorize("hasRole('ADMIN')")` 또는 `@PreAuthorize("@authz.canEdit(#id)")`
- 기본 거부; 필요한 범위만 노출

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

- Bean Validation + `@Valid` 사용
- DTO에 제약조건: `@NotBlank`, `@Email`, `@Size`

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
// BAD: 문자열 연결
@Query(value = "SELECT * FROM users WHERE name = '" + name + "'", nativeQuery = true)

// GOOD: 파라미터 바인딩
@Query(value = "SELECT * FROM users WHERE name = :name", nativeQuery = true)
List<User> findByName(@Param("name") String name);

// GOOD: Spring Data 파생 쿼리
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

- 브라우저 세션 앱: CSRF 활성화
- 순수 API (Bearer 토큰): CSRF 비활성화

```java
http.csrf(csrf -> csrf.disable())
    .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
```

## Secrets Management

```yaml
# BAD: 하드코딩
spring:
  datasource:
    password: mySecretPassword123

# GOOD: 환경 변수
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

- 보안 필터 수준에서 CORS 구성
- 프로덕션에서 `*` 절대 사용 금지

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

- Bucket4j 또는 게이트웨이 수준 제한
- 429 반환 + retry 힌트

## Checklist Before Release

- [ ] 인증 토큰 검증 및 만료 확인
- [ ] 모든 민감한 경로에 인가 가드
- [ ] 모든 입력 검증 및 새니타이즈
- [ ] 문자열 연결 SQL 없음
- [ ] CSRF 설정 앱 유형에 맞음
- [ ] 시크릿 외부화; 커밋된 것 없음
- [ ] 보안 헤더 구성
- [ ] API Rate Limiting
- [ ] 의존성 스캔 및 최신 상태
- [ ] 로그에 민감한 데이터 없음

**기본 원칙**: 기본 거부, 입력 검증, 최소 권한, 설정 기반 보안 우선.
