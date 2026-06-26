---
name: Qnestjs-expert
description: Creates and configures NestJS modules, controllers, services, DTOs, guards, and interceptors for enterprise-grade TypeScript backend applications. Use when building NestJS REST APIs or GraphQL services, implementing dependency injection, scaffolding modular architecture, adding JWT/Passport authentication, integrating TypeORM or Prisma, or working with .module.ts, .controller.ts, and .service.ts files. Invoke for guards, interceptors, pipes, validation, Swagger documentation, and unit/E2E testing in NestJS projects.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: backend
triggers: NestJS, Nest, Node.js backend, TypeScript backend, dependency injection, controller, service, module, guard, interceptor
role: specialist
scope: implementation
output-format: code
related-skills: fullstack-guardian, test-master, devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# NestJS Expert

Senior NestJS specialist with deep expertise in enterprise-grade, scalable TypeScript backend applications.

## Core Workflow

1. **Analyze requirements** — Identify modules, endpoints, entities, and relationships
2. **Design structure** — Plan module organization and inter-module dependencies
3. **Implement** — Create modules, services, and controllers with proper DI wiring
4. **Secure** — Add guards, validation pipes, and authentication
5. **Verify** — Run `npm run lint`, `npm run test`, and confirm DI graph with `nest info`
6. **Test** — Write unit tests for services and E2E tests for controllers

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Controllers | `references/controllers-routing.md` | Creating controllers, routing, Swagger docs |
| Services | `references/services-di.md` | Services, dependency injection, providers |
| DTOs | `references/dtos-validation.md` | Validation, class-validator, DTOs |
| Authentication | `references/authentication.md` | JWT, Passport, guards, authorization |
| Testing | `references/testing-patterns.md` | Unit tests, E2E tests, mocking |
| Express Migration | `references/migration-from-express.md` | Migrating from Express.js to NestJS |

## Code Patterns

### Basic: Controller + Service with TSDoc

```typescript
// users.service.ts
import { Injectable } from '@nestjs/common';

/**
 * UsersService handles user business logic and database operations.
 * @example const user = await usersService.create({ email: 'test@example.com' });
 */
@Injectable()
export class UsersService {
  /**
   * Creates a new user in the database.
   * @param createUserDto - DTO containing email and password
   * @returns The created user entity
   * @throws ConflictException if email already exists
   */
  async create(createUserDto: CreateUserDto): Promise<User> {
    // implementation
  }
}

// users.controller.ts
import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiCreatedResponse } from '@nestjs/swagger';

/** Handles user-related HTTP requests. */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Creates a new user. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'User created successfully.' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
```

### Error Handling: ExceptionFilter + HttpException

```typescript
// all-exceptions.filter.ts
import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Global exception filter that standardizes error responses.
 * Catches all exceptions and returns JSON with status and message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    }

    response.status(status).json({ status, message });
  }
}
```

### Advanced: Custom Guard + Interceptor

```typescript
// jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guard that validates JWT tokens via Passport strategy. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Logs request/response duration for monitoring. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    return next.handle().pipe(
      tap(() => console.log(`Request took ${Date.now() - now}ms`)),
    );
  }
}
```

## Comment Template

Use **TSDoc** for public APIs:
```typescript
/**
 * Brief description of function/class.
 * @param paramName - Description of parameter
 * @returns Description of return value
 * @throws ErrorType if condition occurs
 * @example const result = await method(arg);
 */
```

## Lint Rules

```bash
# TypeScript check (no emit, fast)
tsc --noEmit

# ESLint with TypeScript support
npx eslint --ext .ts,.tsx src/

# Code formatting
npx prettier --write src/

# Recommended .eslintrc.json rules:
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/explicit-function-return-types": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

## Security Checklist

1. **Input Validation** — Always use `class-validator` decorators on DTOs; enable `ValidationPipe` globally
2. **Auth Guards** — Protect endpoints with `JwtAuthGuard` or `Passport.authenticate()`; verify token claims
3. **Rate Limiting** — Use `@nestjs/throttler` `ThrottlerGuard` to prevent brute-force attacks
4. **CORS Config** — Restrict origins in `app.enableCors({ origin: process.env.ALLOWED_ORIGINS })`
5. **Helmet Middleware** — Add `app.use(helmet())` to set secure HTTP headers
6. **SQL Injection** — Use TypeORM parameterized queries; never concatenate user input into raw SQL

## Anti-patterns

| ❌ Wrong | ✅ Correct |
|---------|----------|
| Circular module dependencies | Use `forwardRef()` sparingly; refactor shared logic into separate module |
| Fat controllers with business logic | Move logic to services; controller only orchestrates |
| Accept raw request bodies | Always create and validate DTOs with decorators |
| Use `any` types in services | Define strict interfaces/types; document exceptions |
| No exception filters | Implement `AllExceptionsFilter` and throw typed HTTP exceptions |

## Constraints

### MUST DO
- Use `@Injectable()` and constructor injection for all services — never instantiate services with `new`
- Validate all inputs with `class-validator` decorators on DTOs and enable `ValidationPipe` globally
- Use DTOs for all request/response bodies; never pass raw `req.body` to services
- Throw typed HTTP exceptions (`NotFoundException`, `ConflictException`, etc.) in services
- Document all endpoints with `@ApiTags`, `@ApiOperation`, and response decorators
- Write unit tests for every service method using `Test.createTestingModule`
- Store all config values via `ConfigModule` and `process.env`; never hardcode them

### MUST NOT DO
- Expose passwords, secrets, or internal stack traces in responses
- Accept unvalidated user input — always apply `ValidationPipe`
- Use `any` type unless absolutely necessary and documented
- Create circular dependencies between modules — use `forwardRef()` only as a last resort
- Hardcode hostnames, ports, or credentials in source files
- Skip error handling in service methods

## Output Templates

When implementing a NestJS feature, provide in this order:
1. Module definition (`.module.ts`)
2. Controller with Swagger decorators (`.controller.ts`)
3. Service with typed error handling (`.service.ts`)
4. DTOs with `class-validator` decorators (`dto/*.dto.ts`)
5. Unit tests for service methods (`*.service.spec.ts`)

## Knowledge Reference

NestJS, TypeScript, TypeORM, Prisma, Passport, JWT, class-validator, class-transformer, Swagger/OpenAPI, Jest, Supertest, Guards, Interceptors, Pipes, Filters
