# Code Patterns — Python Pro

> Detailed examples of essential Python patterns with Google-style docstrings, error handling, and async patterns.
> Referenced from SKILL.md when implementing type-safe, production-ready code.

## Overview

These patterns demonstrate idiomatic Python 3.11+ code with full type hints, error handling, and documentation. Each example is production-ready and includes docstrings in Google format.

## Basic: Function with type hints and Google-style docstring

```python
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def read_config(path: Path) -> dict[str, str]:
    """Read configuration from a file.

    Args:
        path: Path to the configuration file.

    Returns:
        Parsed key-value configuration entries.

    Raises:
        FileNotFoundError: If the config file does not exist.
        ValueError: If a line cannot be parsed.

    Example:
        >>> config = read_config(Path("settings.ini"))
        >>> config["host"]
        "localhost"
    """
    config: dict[str, str] = {}
    with path.open() as f:
        for line in f:
            key, _, value = line.partition("=")
            if not key.strip():
                raise ValueError(f"Invalid config line: {line!r}")
            config[key.strip()] = value.strip()
    return config
```

## Intermediate: Error handling with custom exception and logging

```python
import logging
from typing import Any

logger = logging.getLogger(__name__)

class ConfigError(Exception):
    """Raised when configuration loading fails."""
    pass

def parse_json_config(data: str) -> dict[str, Any]:
    """Parse JSON configuration with error handling.

    Args:
        data: JSON string containing configuration.

    Returns:
        Parsed configuration dictionary.

    Raises:
        ConfigError: If JSON is malformed or missing required fields.

    Example:
        >>> config = parse_json_config('{"db": "postgres"}')
        >>> config["db"]
        "postgres"
    """
    try:
        import json
        config = json.loads(data)
        if not isinstance(config, dict):
            raise ConfigError("Root must be a JSON object")
        return config
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse config: {e}")
        raise ConfigError(f"Invalid JSON: {e}") from e
```

## Advanced: Async context manager with dataclass

```python
from dataclasses import dataclass
from contextlib import asynccontextmanager
import asyncio
from typing import Any

@dataclass
class DatabasePool:
    """Database connection pool manager.

    Attributes:
        host: Database server hostname.
        port: Database server port (default 5432).
        pool_size: Number of connections (default 10).

    Example:
        >>> async with DatabasePool("localhost") as pool:
        ...     connection = await pool.acquire()
    """
    host: str
    port: int = 5432
    pool_size: int = 10
    _connections: list[Any] | None = None

    async def __aenter__(self) -> "DatabasePool":
        """Initialize connection pool."""
        self._connections = [None] * self.pool_size
        return self

    async def __aexit__(self, *exc: Any) -> None:
        """Close all connections."""
        if self._connections:
            self._connections.clear()
```

## Dataclass with validation

```python
from dataclasses import dataclass, field

@dataclass
class AppConfig:
    host: str
    port: int
    debug: bool = False
    allowed_origins: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not (1 <= self.port <= 65535):
            raise ValueError(f"Invalid port: {self.port}")
```

## Async pattern with error handling

```python
import asyncio
import httpx
from typing import AsyncGenerator

async def fetch_all(urls: list[str]) -> list[bytes]:
    """Fetch multiple URLs concurrently.

    Args:
        urls: List of URLs to fetch.

    Returns:
        List of response body bytes in original order.

    Raises:
        httpx.HTTPError: If any request fails.
    """
    async with httpx.AsyncClient() as client:
        tasks = [client.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
        return [r.content for r in responses]
```

## pytest fixture and parametrize

```python
import pytest
from pathlib import Path

@pytest.fixture
def config_file(tmp_path: Path) -> Path:
    """Create a temporary config file for testing."""
    cfg = tmp_path / "config.txt"
    cfg.write_text("host=localhost\nport=8080\n")
    return cfg

@pytest.mark.parametrize("port,valid", [(8080, True), (0, False), (99999, False)])
def test_app_config_port_validation(port: int, valid: bool) -> None:
    """Verify port validation logic."""
    if valid:
        AppConfig(host="localhost", port=port)
    else:
        with pytest.raises(ValueError):
            AppConfig(host="localhost", port=port)
```

## Best Practices

- Always include `Args`, `Returns`, `Raises`, and `Example` sections in docstrings
- Use type hints on all parameters and return values
- Prefer `X | None` over `Optional[X]` in Python 3.10+
- Use context managers (`with` statements) for resource handling
- Validate input in `__post_init__` for dataclasses
- Log before raising exceptions for debugging
- Use `async with` for async resource management
