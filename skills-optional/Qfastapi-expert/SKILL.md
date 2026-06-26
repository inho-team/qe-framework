---
name: Qfastapi-expert
description: "Use when building high-performance async Python APIs with FastAPI and Pydantic V2. Invoke to create REST endpoints, define Pydantic models, implement authentication flows, set up async SQLAlchemy database operations, add JWT authentication, build WebSocket endpoints, or generate OpenAPI documentation. Trigger terms: FastAPI, Pydantic, async Python, Python API, REST API Python, SQLAlchemy async, JWT authentication, OpenAPI, Swagger Python."
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: backend
triggers: FastAPI, Pydantic, async Python, Python API, REST API Python, SQLAlchemy async, JWT authentication, OpenAPI, Swagger Python
role: specialist
scope: implementation
output-format: code
related-skills: fullstack-guardian, django-expert, test-master
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# FastAPI Expert

Deep expertise in async Python, Pydantic V2, and production-grade API development with FastAPI.

## When to Use This Skill

- Building REST APIs with FastAPI
- Implementing Pydantic V2 validation schemas
- Setting up async database operations
- Implementing JWT authentication/authorization
- Creating WebSocket endpoints
- Optimizing API performance

## Core Workflow

1. **Analyze requirements** — Identify endpoints, data models, auth needs
2. **Design schemas** — Create Pydantic V2 models for validation
3. **Implement** — Write async endpoints with proper dependency injection
4. **Secure** — Add authentication, authorization, rate limiting
5. **Test** — Run `pytest` after each endpoint group; verify `/docs` before proceeding

## Code Patterns

**Basic: Route with Pydantic Model + Docstring**
```python
@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: DbDep) -> UserResponse:
    """Retrieve a user by ID. Returns 404 if not found."""
    user = await crud.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

**Error Handling: Custom Exception + HTTPException**
```python
class DuplicateEmailError(Exception):
    pass

@router.exception_handler(DuplicateEmailError)
async def duplicate_email_handler(req, exc):
    return JSONResponse(status_code=409, content={"detail": "Email already exists"})
```

**Advanced: Dependency Injection + Async SQLAlchemy**
```python
async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: DbDep) -> User:
    """Verify JWT and return authenticated user."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    user = await crud.get_user(db, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user
```

## Comment Template

Use Google-style Python docstrings:
```python
def process_payment(amount: float, user_id: int) -> dict[str, str]:
    """Process a payment transaction.
    
    Args:
        amount: Payment amount in USD.
        user_id: ID of the user making payment.
        
    Returns:
        Transaction confirmation with status and ID.
        
    Raises:
        ValueError: If amount is negative.
        HTTPException: If user not found (status 404).
    """
```

## Lint Rules

Apply in order:
- **ruff** (linter, imports, complexity): `ruff check .`
- **mypy --strict** (type safety): `mypy . --strict`
- **black** (formatter): `black .`

Config in `pyproject.toml`:
```toml
[tool.ruff]
line-length = 100
[tool.mypy]
strict = true
plugins = ["pydantic.mypy"]
```

## Security Checklist

1. **Input Validation** — Use Pydantic for all request bodies; validate min/max lengths, enums, email format
2. **Authentication** — OAuth2/JWT with signed tokens; never store passwords plaintext; use bcrypt hash
3. **Rate Limiting** — Apply SlowAPI or FastAPI-Limiter to prevent abuse
4. **CORS Misconfiguration** — Whitelist specific origins; never use `allow_origins=["*"]` with credentials
5. **SQL Injection** — Use SQLAlchemy ORM; never interpolate user input into raw SQL
6. **Sensitive Data** — Exclude passwords, tokens, secrets from response models; use `exclude_fields`

## Anti-patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `def get_user(db: Session)` (sync) | `async def get_user(db: AsyncSession)` |
| No validation: `email: str` | Pydantic validation: `email: EmailStr` |
| Global state: `DB = create_engine()` | Dependency injection: `Depends(get_db)` |
| Fat route: 50-line endpoint logic | Extract to service layer: `await UserService.create(...)` |
| Manual parsing: `try/except` json | Pydantic auto-validation + auto-docs |

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Pydantic V2 | `references/pydantic-v2.md` | Creating schemas, validation, model_config |
| SQLAlchemy | `references/async-sqlalchemy.md` | Async database, models, CRUD operations |
| Endpoints | `references/endpoints-routing.md` | APIRouter, dependencies, routing |
| Authentication | `references/authentication.md` | JWT, OAuth2, get_current_user |
| Testing | `references/testing-async.md` | pytest-asyncio, httpx, fixtures |
| Django Migration | `references/migration-from-django.md` | Migrating from Django/DRF to FastAPI |

## Constraints

### MUST DO
- Use type hints everywhere (FastAPI requires them)
- Use Pydantic V2 syntax (`field_validator`, `model_validator`, `model_config`)
- Use `Annotated` pattern for dependency injection
- Use async/await for all I/O operations
- Use `X | None` instead of `Optional[X]`
- Return proper HTTP status codes
- Document endpoints (auto-generated OpenAPI)

### MUST NOT DO
- Use synchronous database operations
- Skip Pydantic validation
- Store passwords in plain text
- Expose sensitive data in responses
- Use Pydantic V1 syntax (`@validator`, `class Config`)
- Mix sync and async code improperly
- Hardcode configuration values

## Output Templates

When implementing FastAPI features, provide:
1. Schema file (Pydantic models)
2. Endpoint file (router with endpoints)
3. CRUD operations if database involved
4. Brief explanation of key decisions

## Knowledge Reference

FastAPI, Pydantic V2, async SQLAlchemy, Alembic migrations, JWT/OAuth2, pytest-asyncio, httpx, BackgroundTasks, WebSockets, dependency injection, OpenAPI/Swagger
