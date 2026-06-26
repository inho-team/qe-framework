# Anti-patterns — Python Pro

> Common Python mistakes with correct alternatives.
> Referenced from SKILL.md to prevent bugs and ensure code quality.

## Overview

These patterns highlight mistakes to avoid. Each section shows the WRONG approach and the CORRECT alternative.

## 1. Mutable Default Arguments

**Why it's wrong:** Default arguments are evaluated once when the function is defined, not each time it's called. Mutable defaults (lists, dicts, sets) are shared across all invocations.

```python
# WRONG — Default list is shared across all calls
def add_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items

result1 = add_item("a")  # ['a']
result2 = add_item("b")  # ['a', 'b'] — BUG: includes previous item!

# CORRECT — New list created for each call
def add_item(item: str, items: list[str] | None = None) -> list[str]:
    if items is None:
        items = []
    items.append(item)
    return items

result1 = add_item("a")  # ['a']
result2 = add_item("b")  # ['b'] — Correct behavior
```

## 2. Bare except Clause

**Why it's wrong:** Catches all exceptions including `KeyboardInterrupt`, `SystemExit`, and breaks debugging. Silently swallowing errors masks bugs.

```python
# WRONG — Silently swallows all errors
try:
    result = risky_operation()
except:
    pass

# CORRECT — Catch specific exceptions and log
try:
    result = risky_operation()
except (ValueError, TypeError) as e:
    logger.error(f"Operation failed: {e}")
    raise  # Re-raise to handle at higher level
```

## 3. Global State Mutation

**Why it's wrong:** Global state is hard to test, debug, and maintain. Creates tight coupling and hidden dependencies.

```python
# WRONG — Mutable global state
config = {}

def set_config(key: str, value: str) -> None:
    config[key] = value

def get_config(key: str) -> str:
    return config.get(key, "")

# Difficult to test: config state carries between tests

# CORRECT — Encapsulated state
class Config:
    def __init__(self) -> None:
        self._data: dict[str, str] = {}
    
    def set(self, key: str, value: str) -> None:
        self._data[key] = value
    
    def get(self, key: str) -> str:
        return self._data.get(key, "")

# Easy to test: create separate Config instances per test
config = Config()
```

## 4. String Concatenation in Loops

**Why it's wrong:** Strings are immutable in Python. Each concatenation creates a new string, resulting in O(n²) time complexity.

```python
# WRONG — O(n²) complexity
result = ""
for item in items:
    result += f"{item}, "

# For 1000 items, this does ~500k string copy operations

# CORRECT — O(n) complexity using join()
result = ", ".join(items)

# For 1000 items, this does one final copy operation
```

## 5. Not Using Context Managers for Files

**Why it's wrong:** File handle may not be closed if an exception occurs between `open()` and `close()`, causing resource leak.

```python
# WRONG — Resource may leak if exception occurs
f = open("file.txt")
data = f.read()
f.close()

# If exception occurs between open() and close(), file stays open

# CORRECT — Automatic cleanup guaranteed
with open("file.txt") as f:
    data = f.read()

# File is always closed, even if exception occurs
```

## Additional Anti-patterns

### 6. Using pickle for untrusted data

```python
# WRONG — Can execute arbitrary code
import pickle
user_data = pickle.loads(request.data)

# CORRECT — Safe parsing
import json
user_data = json.loads(request.data)
```

### 7. SQL concatenation

```python
# WRONG — SQL injection vulnerability
user_id = "1'; DROP TABLE users;--"
query = f"SELECT * FROM users WHERE id = {user_id}"

# CORRECT — Parameterized query
query = "SELECT * FROM users WHERE id = %s"
cursor.execute(query, (user_id,))
```

### 8. Subprocess with shell=True

```python
# WRONG — Shell injection vulnerability
import subprocess
filename = "; rm -rf /"
subprocess.run(f"process {filename}", shell=True)

# CORRECT — Args as list
subprocess.run(["process", filename], check=True)
```

### 9. eval() on user input

```python
# WRONG — Can execute arbitrary code
expression = input("Enter expression: ")
result = eval(expression)

# CORRECT — Use safe parsing
import ast
expression = input("Enter expression: ")
result = ast.literal_eval(expression)
```

### 10. Not validating external URLs (SSRF)

```python
# WRONG — SSRF vulnerability
import httpx
url = request.query_params["url"]
response = httpx.get(url)

# CORRECT — Validate URL and whitelist domains
from urllib.parse import urlparse

ALLOWED_HOSTS = {"api.example.com", "data.example.com"}

url = request.query_params["url"]
parsed = urlparse(url)
if parsed.hostname not in ALLOWED_HOSTS:
    raise ValueError(f"Domain not whitelisted: {parsed.hostname}")
response = httpx.get(url)
```

## Testing Anti-patterns

```python
# WRONG — Test doesn't assert anything
def test_user_creation():
    user = create_user("john")

# CORRECT — Explicit assertions
def test_user_creation():
    user = create_user("john")
    assert user.name == "john"
    assert user.created_at is not None
```

## Related Concepts

- See SKILL.md Security Checklist for security-specific anti-patterns
- See SKILL.md Constraints section for MUST NOT DO rules
- See code-patterns.md for idiomatic Python examples
