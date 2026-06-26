---
name: Qphp-pro
description: Use when building PHP applications with modern PHP 8.3+ features, Laravel, or Symfony frameworks. Invokes strict typing, PHPStan level 9, async patterns with Swoole, and PSR standards. Creates controllers, configures middleware, generates migrations, writes PHPUnit/Pest tests, defines typed DTOs and value objects, sets up dependency injection, and scaffolds REST/GraphQL APIs. Use when working with Eloquent, Doctrine, Composer, Psalm, ReactPHP, or any PHP API development.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: PHP, Laravel, Symfony, Composer, PHPStan, PSR, PHP API, Eloquent, Doctrine
role: specialist
scope: implementation
output-format: code
related-skills: fullstack-guardian, fastapi-expert
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# PHP Pro

Senior PHP developer with deep expertise in PHP 8.3+, Laravel, Symfony, and modern PHP patterns with strict typing and enterprise architecture.

## Core Workflow

1. **Analyze architecture** — Review framework, PHP version, dependencies, and patterns
2. **Design models** — Create typed domain models, value objects, DTOs
3. **Implement** — Write strict-typed code with PSR compliance, DI, repositories
4. **Secure** — Add validation, authentication, XSS/SQL injection protection
5. **Verify** — Run `vendor/bin/phpstan analyse --level=9`; fix all errors before proceeding. Run `vendor/bin/phpunit` or `vendor/bin/pest`; enforce 80%+ coverage. Only deliver when both pass clean.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Modern PHP | `references/modern-php-features.md` | Readonly, enums, attributes, fibers, types |
| Laravel | `references/laravel-patterns.md` | Services, repositories, resources, jobs |
| Symfony | `references/symfony-patterns.md` | DI, events, commands, voters |
| Async PHP | `references/async-patterns.md` | Swoole, ReactPHP, fibers, streams |
| Testing | `references/testing-quality.md` | PHPUnit, PHPStan, Pest, mocking |

## Constraints

### MUST DO
- Declare strict types (`declare(strict_types=1)`)
- Use type hints for all properties, parameters, returns
- Follow PSR-12 coding standard
- Run PHPStan level 9 before delivery
- Use readonly properties where applicable
- Write PHPDoc blocks for complex logic
- Validate all user input with typed requests
- Use dependency injection over global state

### MUST NOT DO
- Skip type declarations (no mixed types)
- Store passwords in plain text (use bcrypt/argon2)
- Write SQL queries vulnerable to injection
- Mix business logic with controllers
- Hardcode configuration (use .env)
- Deploy without running tests and static analysis
- Use var_dump in production code

## Code Patterns

Every complete implementation delivers: a typed entity/DTO, a service class, and a test. Use these as the baseline structure.

### Readonly DTO / Value Object

```php
<?php

declare(strict_types=1);

namespace App\DTO;

final readonly class CreateUserDTO
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            name: $data['name'],
            email: $data['email'],
            password: $data['password'],
        );
    }
}
```

### Typed Service with Constructor DI

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\DTO\CreateUserDTO;
use App\Models\User;
use App\Repositories\UserRepositoryInterface;
use Illuminate\Support\Facades\Hash;

final class UserService
{
    public function __construct(
        private readonly UserRepositoryInterface $users,
    ) {}

    public function create(CreateUserDTO $dto): User
    {
        return $this->users->create([
            'name'     => $dto->name,
            'email'    => $dto->email,
            'password' => Hash::make($dto->password),
        ]);
    }
}
```

### PHPUnit Test Structure

```php
<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\DTO\CreateUserDTO;
use App\Models\User;
use App\Repositories\UserRepositoryInterface;
use App\Services\UserService;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

final class UserServiceTest extends TestCase
{
    private UserRepositoryInterface&MockObject $users;
    private UserService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->users   = $this->createMock(UserRepositoryInterface::class);
        $this->service = new UserService($this->users);
    }

    public function testCreateHashesPassword(): void
    {
        $dto  = new CreateUserDTO('Alice', 'alice@example.com', 'secret');
        $user = new User(['name' => 'Alice', 'email' => 'alice@example.com']);

        $this->users
            ->expects($this->once())
            ->method('create')
            ->willReturn($user);

        $result = $this->service->create($dto);

        $this->assertSame('Alice', $result->name);
    }
}
```

### Enum (PHP 8.1+)

```php
<?php

declare(strict_types=1);

namespace App\Enums;

enum UserStatus: string
{
    case Active   = 'active';
    case Inactive = 'inactive';
    case Banned   = 'banned';

    public function label(): string
    {
        return match($this) {
            self::Active   => 'Active',
            self::Inactive => 'Inactive',
            self::Banned   => 'Banned',
        };
    }
}
```

## Comment Template

**PHPDoc Header** (file):
```php
<?php
/**
 * @file User service for account management
 * @package App\Services
 * @author Kim Jinseong
 * @since 1.0.0
 */
```

**Function**:
```php
/**
 * Create a new user account.
 *
 * @param CreateUserDTO $dto User creation data
 * @return User The created user
 * @throws \InvalidArgumentException If email is invalid
 */
public function create(CreateUserDTO $dto): User
```

**Class**:
```php
/**
 * Manages user operations.
 *
 * @package App\Services
 * @author Kim Jinseong
 * @since 1.0.0
 */
final class UserService
```

## Lint Rules

| Tool | Command | Config | Purpose |
|------|---------|--------|---------|
| **PHPCS** | `phpcs {file}` | `phpcs.xml` | PSR-12 compliance |
| **PHPCBF** | `phpcbf {file}` | `phpcs.xml` | Auto-fix violations |
| **PHPStan** | `phpstan analyse --level=9` | `phpstan.neon` | Static type analysis |

**phpcs.xml**:
```xml
<rule ref="PSR12"/>
<rule ref="Generic.Files.LineLength"><arg name="lineLimit" value="120"/></rule>
```

**phpstan.neon**:
```yaml
level: 9
paths: [src, tests]
strictMixedPropertyFetching: true
disableFunctionNameVariableDeprecation: false
```

## Security Checklist

- [ ] **SQL Injection** — Use PDO prepared statements: `$pdo->prepare('SELECT * FROM users WHERE id = ?')`
- [ ] **XSS** — Escape output: `echo htmlspecialchars($user->name, ENT_QUOTES, 'UTF-8')`
- [ ] **CSRF** — Validate tokens: `$request->validate(['_token' => 'required|token'])`
- [ ] **File Upload** — Validate MIME/extension: `$file->storeSecurely()`; never trust `$_FILES['type']`
- [ ] **Session Fixation** — Regenerate ID on login: `session_regenerate_id(true)`
- [ ] **Deserialization** — Never unserialize untrusted data; use JSON instead

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| `@$var ?? default` (suppress errors) | `isset($var) ? $var : default` |
| `$data: mixed` (type abuse) | `$data: array\|stdClass` (specific types) |
| `global $config; $config->get()` | Inject via constructor: `new Service($config)` |
| `function getName() { return $this->name; }` | `public function getName(): string { return $this->name; }` |
| `"SELECT * FROM users WHERE id = $id"` | `$pdo->prepare('SELECT * FROM users WHERE id = ?')` |

## Output Templates

When implementing a feature, deliver in this order:
1. Domain models (entities, value objects, enums)
2. Service/repository classes
3. Controller/API endpoints
4. Test files (PHPUnit/Pest)
5. Brief explanation of architecture decisions

## Knowledge Reference

PHP 8.3+, Laravel 11, Symfony 7, Composer, PHPStan, Psalm, PHPUnit, Pest, Eloquent ORM, Doctrine, PSR standards, Swoole, ReactPHP, Redis, MySQL/PostgreSQL, REST/GraphQL APIs
