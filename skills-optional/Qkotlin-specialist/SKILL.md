---
name: Qkotlin-specialist
description: Provides idiomatic Kotlin implementation patterns including coroutine concurrency, Flow stream handling, multiplatform architecture, Compose UI construction, Ktor server setup, and type-safe DSL design. Use when building Kotlin applications requiring coroutines, multiplatform development, or Android with Compose. Invoke for Flow API, KMP projects, Ktor servers, DSL design, sealed classes, suspend function, Android Kotlin, Kotlin Multiplatform.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: Kotlin, coroutines, Kotlin Multiplatform, KMP, Jetpack Compose, Ktor, Flow, Android Kotlin, suspend function
role: specialist
scope: implementation
output-format: code
related-skills: test-master
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Kotlin Specialist

Senior Kotlin developer with deep expertise in coroutines, Kotlin Multiplatform (KMP), and modern Kotlin 1.9+ patterns.

## Core Workflow

1. **Analyze architecture** - Identify platform targets, coroutine patterns, shared code strategy
2. **Design models** - Create sealed classes, data classes, type hierarchies
3. **Implement** - Write idiomatic Kotlin with coroutines, Flow, extension functions
   - *Checkpoint:* Verify coroutine cancellation is handled (parent scope cancelled on teardown) and null safety is enforced before proceeding
4. **Validate** - Run `detekt` and `ktlint`; verify coroutine cancellation handling and null safety
   - *If detekt/ktlint fails:* Fix all reported issues and re-run both tools before proceeding to step 5
5. **Optimize** - Apply inline classes, sequence operations, compilation strategies
6. **Test** - Write multiplatform tests with coroutine test support (`runTest`, Turbine)

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Coroutines & Flow | `references/coroutines-flow.md` | Async operations, structured concurrency, Flow API |
| Multiplatform | `references/multiplatform-kmp.md` | Shared code, expect/actual, platform setup |
| Android & Compose | `references/android-compose.md` | Jetpack Compose, ViewModel, Material3, navigation |
| Ktor Server | `references/ktor-server.md` | Routing, plugins, authentication, serialization |
| DSL & Idioms | `references/dsl-idioms.md` | Type-safe builders, scope functions, delegates |

## Key Patterns

### Sealed Classes for State Modeling

```kotlin
sealed class UiState<out T> {
    data object Loading : UiState<Nothing>()
    data class Success<T>(val data: T) : UiState<T>()
    data class Error(val message: String, val cause: Throwable? = null) : UiState<Nothing>()
}

// Consume exhaustively — compiler enforces all branches
fun render(state: UiState<User>) = when (state) {
    is UiState.Loading  -> showSpinner()
    is UiState.Success  -> showUser(state.data)
    is UiState.Error    -> showError(state.message)
}
```

### Coroutines & Flow

```kotlin
// Use structured concurrency — never GlobalScope
class UserRepository(private val api: UserApi, private val scope: CoroutineScope) {

    fun userUpdates(id: String): Flow<UiState<User>> = flow {
        emit(UiState.Loading)
        try {
            emit(UiState.Success(api.fetchUser(id)))
        } catch (e: IOException) {
            emit(UiState.Error("Network error", e))
        }
    }.flowOn(Dispatchers.IO)

    private val _user = MutableStateFlow<UiState<User>>(UiState.Loading)
    val user: StateFlow<UiState<User>> = _user.asStateFlow()
}

// Anti-pattern — blocks the calling thread; avoid in production
// runBlocking { api.fetchUser(id) }
```

### Null Safety

```kotlin
// Prefer safe calls and elvis operator
val displayName = user?.profile?.name ?: "Anonymous"

// Use let to scope nullable operations
user?.email?.let { email -> sendNotification(email) }

// !! only when the null case is a true contract violation and documented
val config = requireNotNull(System.getenv("APP_CONFIG")) { "APP_CONFIG must be set" }
```

### Scope Functions

```kotlin
// apply — configure an object, returns receiver
val request = HttpRequest().apply {
    url = "https://api.example.com/users"
    headers["Authorization"] = "Bearer $token"
}

// let — transform nullable / introduce a local scope
val length = name?.let { it.trim().length } ?: 0

// also — side-effects without changing the chain
val user = createUser(form).also { logger.info("Created user ${it.id}") }
```

## Constraints

### MUST DO
- Use null safety (`?`, `?.`, `?:`, `!!` only when contract guarantees non-null)
- Prefer `sealed class` for state modeling
- Use `suspend` functions for async operations
- Leverage type inference but be explicit when needed
- Use `Flow` for reactive streams
- Apply scope functions appropriately (`let`, `run`, `apply`, `also`, `with`)
- Document public APIs with KDoc
- Use explicit API mode for libraries
- Run `detekt` and `ktlint` before committing
- Verify coroutine cancellation is handled (cancel parent scope on teardown)

### MUST NOT DO
- Block coroutines with `runBlocking` in production code
- Use `!!` without documented justification
- Mix platform-specific code in common modules
- Skip null safety checks
- Use `GlobalScope.launch` (use structured concurrency)
- Ignore coroutine cancellation
- Create memory leaks with coroutine scopes

## Output Templates

When implementing Kotlin features, provide:
1. Data models (sealed classes, data classes)
2. Implementation file (extension functions, suspend functions)
3. Test file with coroutine test support
4. Brief explanation of Kotlin-specific patterns used

## Code Patterns

### Basic: Data Class + Extension Function

```kotlin
/** User profile model. @property id unique identifier @property email contact */
data class User(val id: String, val email: String, val name: String)

/** Validates email format. @return true if well-formed */
fun User.isValidEmail(): Boolean =
    email.matches(Regex("^[\\w.-]+@[\\w.-]+\\.\\w+$"))
```

### Error Handling: Sealed Class Result + runCatching

```kotlin
/**
 * Represents the outcome of an operation.
 * Use exhaustive `when` to handle success and failure.
 */
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Failure(val error: Throwable) : Result<Nothing>()
}

/**
 * Safely executes a suspend function, wrapping result or error.
 *
 * @param block Suspend operation to execute
 * @return Result containing success data or error exception
 */
suspend inline fun <T> safeCall(block: suspend () -> T): Result<T> =
    runCatching { block() }.fold(
        onSuccess = { Result.Success(it) },
        onFailure = { Result.Failure(it) }
    )
```

### Advanced: Coroutine Flow + StateFlow

```kotlin
/** Repository with reactive state management. @property api service client */
class UserRepository(private val api: UserApi) {
    private val _state = MutableStateFlow<UiState<List<User>>>(UiState.Loading)
    
    /** StateFlow emitting Loading/Success/Error states. @throws IOException on network failure */
    val state: StateFlow<UiState<List<User>>> = _state.asStateFlow()
}
```

## Comment Template

### KDoc Structure

**Function:**
```kotlin
/**
 * Brief one-liner describing what the function does.
 *
 * Detailed explanation of behavior, edge cases, or caveats.
 *
 * @param paramName Description of parameter purpose
 * @return Description of return value
 * @throws ExceptionType When this exception is thrown
 * @sample exampleCode()
 */
```

**Class:**
```kotlin
/**
 * Purpose: What problem does this class solve?
 *
 * @property fieldName Role of this property in the class
 * @constructor Initializes with these dependencies
 */
```

**File:**
```kotlin
/**
 * @file Package documentation describing module purpose.
 */
package com.example.domain
```

## Lint Rules

**ktlint** — Kotlin code formatter enforcing style consistency:
```bash
ktlint {file}           # Check formatting violations
ktlint -F {file}        # Auto-fix formatting (trailing commas, spacing, etc.)
```

**detekt** — Static analysis detecting bugs, code smells, performance issues:
```bash
detekt --input {file}   # Analyze for issues
```

**Configuration:**
- `.editorconfig` — IDE settings (indentation, line length)
- `detekt.yml` — Custom detekt rules, complexity thresholds, suppression patterns

## Security Checklist

- **SQL Injection**: Use parameterized queries; never concatenate user input into SQL strings
- **Serialization**: Validate deserialized objects; avoid untrusted JSON unmarshaling without schema
- **Coroutine Cancellation**: Always cancel child scopes on teardown; never use GlobalScope in lifecycle-aware code
- **Reflection Abuse**: Limit reflection to plugin loading; validate reflected class/method existence before invocation
- **Hardcoded Secrets**: Use environment variables or secure config; never commit API keys, tokens, or passwords

## Anti-patterns

| Wrong | Correct | Why |
|-------|---------|-----|
| `val x = obj!!.property` | `val x = obj?.property ?: default` | !! silently crashes; safe-call handles null gracefully |
| `var x = 5; x = 10` | `val x = 5; val y = 10` (or mutable when truly necessary) | val is immutable; prevents accidental state changes |
| `callback { result -> callback { data -> ... } }` | `result.flatMap { data -> ... }` or `coroutineScope { ... }` | Callback hell is hard to read/cancel; Flow + coroutines are composable |
| Activity holds entire UI state; no separation | ViewModel + StateFlow manages state, Activity renders | God activities leak memory; ViewModel survives config changes |
| `when (obj) { is TypeA -> ... else -> ... }` | `sealed class State { class TypeA, class TypeB } when (obj) { ... }` | sealed forces exhaustiveness; prevents runtime bugs |

## Knowledge Reference

Kotlin 1.9+, Coroutines, Flow API, StateFlow/SharedFlow, Kotlin Multiplatform, Jetpack Compose, Ktor, Arrow.kt, kotlinx.serialization, Detekt, ktlint, Gradle Kotlin DSL, JUnit 5, MockK, Turbine
