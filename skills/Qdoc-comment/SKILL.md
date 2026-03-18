---
name: Qdoc-comment
description: "Adds documentation comments to code in the appropriate language format. Use for add docs, document this function, add JSDoc, docstring, add comments to code. Supports JavaDoc, Python docstring, TSDoc, godoc, KDoc, rustdoc. Distinct from Qdoc-converter (which converts file formats) — this skill adds inline code comments."
---
> Shared principles: see core/PRINCIPLES.md

# Qdoc-comment — Add Documentation Comments

## Role
Automatically detects the project's language and existing comment style, then adds documentation comments to classes, functions, and methods that lack them.

## Execution Steps

### Step 1: Language Detection
- First check `.qe/analysis/tech-stack.md` to identify the project language
- If unavailable, determine by file extension (.java, .py, .ts, .go, .kt, etc.)

### Step 2: Existing Style Analysis
- Sample existing comments in the project to understand the style
- Maintain consistency in language, tone, and format (English/Korean, use of tags, etc.)

### Step 3: Add Comments
- Find public/exported classes, functions, and methods without comments and add them
- Do not modify existing comments

## Comment Format by Language

### Java (JavaDoc)
```java
/**
 * [Class/method description]
 *
 * @param paramName [description]
 * @return [return value description]
 */
```

### Python (docstring)
```python
def example(param: str) -> bool:
    """[Function description]

    Args:
        param: [description]

    Returns:
        [return value description]
    """
```

### TypeScript / JavaScript (TSDoc/JSDoc)
```typescript
/**
 * [Function description]
 *
 * @param paramName - [description]
 * @returns [return value description]
 */
```

### Go (godoc)
```go
// FunctionName [function description]
//
// [Additional detail if needed]
```

### Kotlin (KDoc)
```kotlin
/**
 * [Class/function description]
 *
 * @param paramName [description]
 * @return [return value description]
 */
```

### Rust (rustdoc)
```rust
/// [Function description]
///
/// # Arguments
/// * `param` - [description]
///
/// # Returns
/// [return value description]
```

## Comment Writing Rules
- Follow the project's existing language (English or Korean)
- Use technical terms in their original form
- Keep it concise and clear — "retrieves ~", "saves ~", "converts ~"
- Omit self-evident functions (getters/setters, toString, etc.)

## Will
- Automatically detect language
- Add comments matching the existing style
- Write comments for public APIs and complex private/internal functions

## Will Not
- Modify or overwrite existing comments
- Force unnecessary comments on self-evident functions (getters/setters, simple delegators)
- Modify code logic
