---
name: Qpython-pro
description: Use when building Python 3.11+ applications requiring type safety, async programming, or robust error handling. Generates type-annotated Python code, configures mypy in strict mode, writes pytest test suites with fixtures and mocking, and validates code with black and ruff. Invoke for type hints, async/await patterns, dataclasses, dependency injection, logging configuration, and structured error handling.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: Python development, type hints, async Python, pytest, mypy, dataclasses, Python best practices, Pythonic code
role: specialist
scope: implementation
output-format: code
related-skills: fastapi-expert, devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Python Pro

Modern Python 3.11+ specialist focused on type-safe, async-first, production-ready code.

## When to Use This Skill

- Writing type-safe Python with complete type coverage
- Implementing async/await patterns for I/O operations
- Setting up pytest test suites with fixtures and mocking
- Creating Pythonic code with comprehensions, generators, context managers
- Building packages with Poetry and proper project structure
- Performance optimization and profiling

## Core Workflow

1. **Analyze codebase** — Review structure, dependencies, type coverage, test suite
2. **Design interfaces** — Define protocols, dataclasses, type aliases
3. **Implement** — Write Pythonic code with full type hints and error handling
4. **Test** — Create comprehensive pytest suite with >90% coverage
5. **Validate** — Run `mypy --strict`, `black`, `ruff`
   - If mypy fails: fix type errors reported and re-run before proceeding
   - If tests fail: debug assertions, update fixtures, and iterate until green
   - If ruff/black reports issues: apply auto-fixes, then re-validate

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Code Patterns | `references/code-patterns.md` | Functions, error handling, dataclasses, async patterns |
| Anti-patterns | `references/anti-patterns.md` | Mutable defaults, bare except, globals, string loops, file handling |
| Type System | `references/type-system.md` | Type hints, mypy, generics, Protocol |
| Testing | `references/testing.md` | pytest, fixtures, mocking, parametrize |
| Async Patterns | `references/async-patterns.md` | async/await, asyncio, task groups, context managers |

## Constraints

### MUST DO
- Type hints for all function signatures and class attributes
- PEP 8 compliance with black formatting
- Comprehensive docstrings (Google style)
- Test coverage exceeding 90% with pytest
- Use `X | None` instead of `Optional[X]` (Python 3.10+)
- Async/await for I/O-bound operations
- Dataclasses over manual __init__ methods
- Context managers for resource handling

### MUST NOT DO
- Skip type annotations on public APIs
- Use mutable default arguments
- Mix sync and async code improperly
- Ignore mypy errors in strict mode
- Use bare except clauses
- Hardcode secrets or configuration
- Use deprecated stdlib modules (use pathlib not os.path)

## Code Patterns

Python Pro uses three essential patterns: basic type-annotated functions, error handling with custom exceptions, and async context managers. See `references/code-patterns.md` for complete examples.

**Basic:** Function with type hints and Google-style docstring
```python
def read_config(path: Path) -> dict[str, str]:
    """Read configuration from a file.
    
    Args:
        path: Path to the configuration file.
    
    Returns:
        Parsed key-value configuration entries.
    """
    ...
```

**Intermediate:** Error handling with custom exception and logging
```python
class ConfigError(Exception):
    """Raised when configuration loading fails."""
    pass

def parse_json_config(data: str) -> dict[str, Any]:
    """Parse JSON configuration."""
    try:
        config = json.loads(data)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse: {e}")
        raise ConfigError(f"Invalid JSON: {e}") from e
```

**Advanced:** Async context manager with dataclass
```python
@dataclass
class DatabasePool:
    """Database connection pool manager."""
    host: str
    port: int = 5432
    
    async def __aenter__(self) -> "DatabasePool":
        """Initialize connection pool."""
        return self
```

## Comment Template

Use **Google-style docstrings** for all modules, classes, and functions:

```python
"""Module docstring: One-line summary. Optional longer description."""

def function_name(param: str) -> int:
    """Brief description.
    
    Args:
        param: Parameter description.
    
    Returns:
        Return value description.
    
    Raises:
        ValueError: Error description.
    
    Example:
        >>> function_name("test")
        42
    """

class ClassName:
    """Class docstring.
    
    Attributes:
        attr: Attribute description.
    """
```

## Lint Rules

Validate all Python code against these standards:

```bash
# Static analysis
ruff check {file}                  # Report style and logic issues
ruff check --fix {file}            # Auto-fix fixable issues

# Type checking (strict mode required)
mypy --strict {file}               # Verify full type coverage

# Code formatting
black {file}                        # Enforce consistent formatting
```

### Configuration (pyproject.toml)
```toml
[tool.mypy]
python_version = "3.11"
strict = true
warn_return_any = true
warn_unused_configs = true

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "UP", "B"]

[tool.black]
line-length = 100
target-version = ["py311"]
```

### Thresholds
- **No `Any` types** in public API signatures
- **100% type coverage** for public functions and classes
- **Zero ruff warnings** before merge
- **mypy --strict must pass** with no deviations

## Security Checklist

Before committing code, verify:

- **SQL Injection** — Use parameterized queries: `cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))`
- **Pickle Deserialization** — Never deserialize untrusted data; use `json` instead of `pickle`
- **subprocess shell=True** — Always pass arguments as list: `subprocess.run(["process", filename], check=True)`
- **eval/exec** — Forbidden on user input; use `json.loads()` or `ast.literal_eval()` instead
- **SSRF via requests** — Validate URLs: check `urlparse(url).hostname` against whitelist before requesting
- **Secrets in Code** — Never hardcode credentials; always use environment variables via `os.environ`

## Anti-patterns

Avoid common mistakes: mutable default arguments, bare except clauses, global state mutation, string concatenation in loops, and ignoring context managers. See `references/anti-patterns.md` for complete examples and explanations.

## Output Templates

When implementing Python features, provide:
1. Module file with complete type hints
2. Test file with pytest fixtures
3. Type checking confirmation (mypy --strict passes)
4. Brief explanation of Pythonic patterns used

## Knowledge Reference

Python 3.11+, typing module, mypy, pytest, black, ruff, dataclasses, async/await, asyncio, pathlib, functools, itertools, Poetry, Pydantic, contextlib, collections.abc, Protocol
