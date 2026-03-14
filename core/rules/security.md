# Security Rules -- Execution-Level Checklist

> Referenced by: Ecode-reviewer, Ecode-test-engineer

Complements PRINCIPLES.md "Safety Principles". This file provides actionable checks.

## Input Validation

- [ ] All user inputs are validated (type, length, range, format)
- [ ] Allowlist validation preferred over denylist
- [ ] File paths are sanitized (no path traversal: `../`)
- [ ] URL inputs are validated against allowed schemes and domains

## SQL Injection Prevention

- [ ] Parameterized queries or ORM used for all database operations
- [ ] No string concatenation in SQL statements
- [ ] Stored procedures use parameterized inputs

## XSS Prevention

- [ ] All dynamic output is escaped/encoded for the output context (HTML, JS, URL, CSS)
- [ ] Content-Security-Policy header configured
- [ ] User-generated HTML sanitized with allowlist-based sanitizer

## Authentication / Authorization

- [ ] Authentication required for all non-public endpoints
- [ ] Authorization checks at the resource level (not just route level)
- [ ] Session tokens use secure, httpOnly, sameSite flags
- [ ] Password hashing uses bcrypt/argon2 (not MD5/SHA1)

## Sensitive Data Exposure

- [ ] Secrets stored in environment variables or secret manager (never in code)
- [ ] Logs do not contain passwords, tokens, or PII
- [ ] Error messages do not leak stack traces or internal paths to users
- [ ] HTTPS enforced for all external communication

## CSRF Protection

- [ ] State-changing operations require CSRF token or SameSite cookie
- [ ] CORS configured with explicit allowed origins (not wildcard for credentialed requests)

## Security Headers

- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY` or `SAMEORIGIN`
- [ ] `Strict-Transport-Security` configured
- [ ] `Content-Security-Policy` configured
