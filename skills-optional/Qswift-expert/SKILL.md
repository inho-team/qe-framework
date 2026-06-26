---
name: Qswift-expert
description: Builds iOS/macOS/watchOS/tvOS applications, implements SwiftUI views and state management, designs protocol-oriented architectures, handles async/await concurrency, implements actors for thread safety, and debugs Swift-specific issues. Use when building iOS/macOS applications with Swift 5.9+, SwiftUI, or async/await concurrency. Invoke for protocol-oriented programming, SwiftUI state management, actors, server-side Swift, UIKit integration, Combine, or Vapor.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: Swift, SwiftUI, iOS development, macOS development, async/await Swift, Combine, UIKit, Vapor
role: specialist
scope: implementation
output-format: code
related-skills: 
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Swift Expert

## Core Workflow

1. **Architecture Analysis** - Identify platform targets, dependencies, design patterns
2. **Design Protocols** - Create protocol-first APIs with associated types
3. **Implement** - Write type-safe code with async/await and value semantics
4. **Optimize** - Profile with Instruments, ensure thread safety
5. **Test** - Write comprehensive tests with XCTest and async patterns

> **Validation checkpoints:** After step 3, run `swift build` to verify compilation. After step 4, run `swift build -warnings-as-errors` to surface actor isolation and Sendable warnings. After step 5, run `swift test` and confirm all async tests pass.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| SwiftUI | `references/swiftui-patterns.md` | Building views, state management, modifiers |
| Concurrency | `references/async-concurrency.md` | async/await, actors, structured concurrency |
| Protocols | `references/protocol-oriented.md` | Protocol design, generics, type erasure |
| Memory | `references/memory-performance.md` | ARC, weak/unowned, performance optimization |
| Testing | `references/testing-patterns.md` | XCTest, async tests, mocking strategies |

## Code Patterns

### 1. Struct + Protocol Conformance (Basic)

```swift
/// A protocol defining repository behavior for generic entity types.
protocol DataRepository<T> {
    /// The entity type this repository manages.
    associatedtype T: Identifiable
    
    /// Fetches an entity by its identifier.
    /// - Parameters:
    ///   - id: The unique identifier of the entity.
    /// - Returns: The fetched entity.
    /// - Throws: `RepositoryError` if fetch fails.
    func fetch(id: T.ID) async throws -> T
}

/// A concrete repository implementation for User entities.
struct UserRepository: DataRepository {
    typealias T = User
    
    func fetch(id: UUID) async throws -> User {
        // Implementation with proper error handling
        return User(id: id, name: "John")
    }
}
```

### 2. Error Handling: Enum + Do-Catch + Typed Throws

```swift
/// Errors that can occur during repository operations.
enum RepositoryError: Error, LocalizedError {
    case notFound
    case networkTimeout
    case invalidResponse
    
    var errorDescription: String? {
        switch self {
        case .notFound: return "Entity not found"
        case .networkTimeout: return "Request timed out"
        case .invalidResponse: return "Invalid server response"
        }
    }
}

/// Fetches data with comprehensive error handling.
/// - Parameters:
///   - url: The endpoint URL.
/// - Returns: Decoded response data.
/// - Throws: `RepositoryError` on network or parsing failure.
func fetchData(from url: URL) async throws(RepositoryError) -> Data {
    do {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw .invalidResponse
        }
        return data
    } catch {
        throw .networkTimeout
    }
}
```

### 3. Advanced: async/await + Actor Pattern

```swift
/// Thread-safe image cache using actor isolation.
actor ImageCache {
    /// Stores cached images keyed by URL.
    private var storage: [URL: UIImage] = [:]
    
    /// Retrieves a cached image.
    /// - Parameters:
    ///   - url: The image URL key.
    /// - Returns: Cached image or nil.
    nonisolated func image(for url: URL) -> UIImage? {
        // Note: nonisolated read from stored property requires synchronization
        return storage[url]
    }
    
    /// Stores an image in the cache.
    /// - Parameters:
    ///   - image: The image to cache.
    ///   - url: The key URL.
    func store(_ image: UIImage, for url: URL) async {
        storage[url] = image
    }
}

/// Example async/await usage with error handling.
func fetchAndCache(url: URL, cache: ImageCache) async throws -> UIImage {
    let (data, _) = try await URLSession.shared.data(from: url)
    guard let image = UIImage(data: data) else {
        throw RepositoryError.invalidResponse
    }
    await cache.store(image, for: url)
    return image
}
```

## Comment Template

### Function Documentation
```swift
/// Performs a specific task with documented parameters and return value.
///
/// - Parameters:
///   - param1: Description of the first parameter and its constraints.
///   - param2: Description of the second parameter and expected type.
/// - Returns: Description of the return value and when it's nil/empty.
/// - Throws: `ErrorType` when specific failure conditions occur.
/// - Complexity: O(n) where n is the size of the input collection.
func exampleFunction(param1: String, param2: Int) async throws -> Result {
    // Implementation
}
```

### Type Documentation
```swift
/// A view model managing user state and interactions.
///
/// This type centralizes business logic for user-facing features,
/// reducing code duplication across views. It uses @Observable for
/// automatic change propagation in SwiftUI.
@Observable
final class UserViewModel {
    var user: User?
    var isLoading = false
}
```

### File Header
```swift
//
// UserRepository.swift
// MyApp
//
// Created by [Name] on [Date].
// Copyright [Year] [Company]. All rights reserved.
//
// Responsibilities:
// - Fetch and save user data from network
// - Cache responses to reduce network calls
// - Map API responses to model types
```

## Lint Rules

**Commands:**
- `swiftlint lint` — Check for style violations
- `swiftlint --fix` — Auto-correct fixable issues
- `swiftc -typecheck` — Verify type safety without building

**Configuration** (.swiftlint.yml):
```yaml
disabled_rules:
  - trailing_whitespace
opt_in_rules:
  - force_unwrapping
  - missing_docs
line_length: 120
```

## Security Checklist

1. **Keychain Storage** — Never hardcode secrets; use `SecureEnclave` or `Keychain` APIs
2. **ATS Enforcement** — Require HTTPS via `NSSecureTransportRequired = true`
3. **Input Validation** — Validate all network responses and user inputs before use
4. **Biometric Auth Bypass** — Implement PIN/password fallback for Face/Touch ID failures
5. **Jailbreak Detection** — Check filesystem access and code signature integrity before accessing sensitive data

## Anti-Patterns (Wrong vs. Correct)

| Anti-Pattern | ❌ Wrong | ✅ Correct |
|---|---|---|
| Force Unwrap | `let value = optionalValue!` | `guard let value = optionalValue else { return }` |
| Massive View Controller | 500+ line UIViewController with all logic | Split into smaller views + ViewModel |
| Retain Cycles | `[weak self] in { self?.property }` without guard | Use `guard let self else { return }` pattern |
| Stringly-Typed APIs | `userDefaults.string(forKey: "userName")` | Define typed `@UserDefault` property wrapper |
| Not Using Value Types | `class Model { var name: String }` | Use `struct Model { var name: String }` |

## Constraints

### MUST DO
- Use type hints and inference appropriately
- Follow Swift API Design Guidelines
- Use `async/await` for asynchronous operations (see pattern above)
- Ensure `Sendable` compliance for concurrency
- Use value types (`struct`/`enum`) by default
- Document APIs with markup comments (`/// …`)
- Use property wrappers for cross-cutting concerns
- Profile with Instruments before optimizing

### MUST NOT DO
- Use force unwrapping (`!`) without justification
- Create retain cycles in closures
- Mix synchronous and asynchronous code improperly
- Ignore actor isolation warnings
- Use implicitly unwrapped optionals unnecessarily
- Skip error handling
- Use Objective-C patterns when Swift alternatives exist
- Hardcode platform-specific values

## Output Templates

When implementing Swift features, provide:
1. Protocol definitions and type aliases
2. Model types (structs/classes with value semantics)
3. View implementations (SwiftUI) or view controllers
4. Tests demonstrating usage
5. Brief explanation of architectural decisions
