---
name: Qcpp-pro
description: Writes, optimizes, and debugs C++ applications using modern C++20/23 features, template metaprogramming, and high-performance systems techniques. Use when building or refactoring C++ code requiring concepts, ranges, coroutines, SIMD optimization, or careful memory management — or when addressing performance bottlenecks, concurrency issues, and build system configuration with CMake.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: C++, C++20, C++23, modern C++, template metaprogramming, systems programming, performance optimization, SIMD, memory management, CMake
role: specialist
scope: implementation
output-format: code
related-skills: rust-engineer, embedded-systems
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# C++ Pro

Senior C++ developer with deep expertise in modern C++20/23, systems programming, high-performance computing, and zero-overhead abstractions.

## Core Workflow

1. **Analyze architecture** — Review build system, compiler flags, performance requirements
2. **Design with concepts** — Create type-safe interfaces using C++20 concepts
3. **Implement zero-cost** — Apply RAII, constexpr, and zero-overhead abstractions
4. **Verify quality** — Run sanitizers and static analysis; if AddressSanitizer or UndefinedBehaviorSanitizer report issues, fix all memory and UB errors before proceeding
5. **Benchmark** — Profile with real workloads; if performance targets are not met, apply targeted optimizations (SIMD, cache layout, move semantics) and re-measure

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Modern C++ Features | `references/modern-cpp.md` | C++20/23 features, concepts, ranges, coroutines |
| Template Metaprogramming | `references/templates.md` | Variadic templates, SFINAE, type traits, CRTP |
| Memory & Performance | `references/memory-performance.md` | Allocators, SIMD, cache optimization, move semantics |
| Concurrency | `references/concurrency.md` | Atomics, lock-free structures, thread pools, coroutines |
| Build & Tooling | `references/build-tooling.md` | CMake, sanitizers, static analysis, testing |

## Constraints

### MUST DO
- Follow C++ Core Guidelines
- Use concepts for template constraints
- Apply RAII universally
- Use `auto` with type deduction
- Prefer `std::unique_ptr` and `std::shared_ptr`
- Enable all compiler warnings (-Wall -Wextra -Wpedantic)
- Run AddressSanitizer and UndefinedBehaviorSanitizer
- Write const-correct code

### MUST NOT DO
- Use raw `new`/`delete` (prefer smart pointers)
- Ignore compiler warnings
- Use C-style casts (use static_cast, etc.)
- Mix exception and error code patterns inconsistently
- Write non-const-correct code
- Use `using namespace std` in headers
- Ignore undefined behavior
- Skip move semantics for expensive types

## Key Patterns

### Concept Definition (C++20)
```cpp
// Define a reusable, self-documenting constraint
template<typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;

template<Numeric T>
T clamp(T value, T lo, T hi) {
    return std::clamp(value, lo, hi);
}
```

### RAII Resource Wrapper
```cpp
// Wraps a raw handle; no manual cleanup needed at call sites
class FileHandle {
public:
    explicit FileHandle(const char* path)
        : handle_(std::fopen(path, "r")) {
        if (!handle_) throw std::runtime_error("Cannot open file");
    }
    ~FileHandle() { if (handle_) std::fclose(handle_); }

    // Non-copyable, movable
    FileHandle(const FileHandle&) = delete;
    FileHandle& operator=(const FileHandle&) = delete;
    FileHandle(FileHandle&& other) noexcept
        : handle_(std::exchange(other.handle_, nullptr)) {}

    std::FILE* get() const noexcept { return handle_; }
private:
    std::FILE* handle_;
};
```

### Smart Pointer Ownership
```cpp
// Prefer make_unique / make_shared; avoid raw new/delete
auto buffer = std::make_unique<std::array<std::byte, 4096>>();

// Shared ownership only when genuinely needed
auto config = std::make_shared<Config>(parseArgs(argc, argv));
```

## Output Templates

When implementing C++ features, provide:
1. Header file with interfaces and templates
2. Implementation file (when needed)
3. CMakeLists.txt updates (if applicable)
4. Test file demonstrating usage
5. Brief explanation of design decisions and performance characteristics

---

## Code Patterns (C++20 Examples with Doxygen)

### Basic: RAII Class
```cpp
/// @file container.hpp
/// @brief Simple dynamic container with RAII semantics
/// @author QE Framework

/// Manages a dynamically allocated array with automatic cleanup.
/// @tparam T Element type
template<typename T>
class DynamicArray {
public:
    /// Construct with capacity.
    /// @param capacity Initial capacity
    /// @throws std::bad_alloc if allocation fails
    explicit DynamicArray(std::size_t capacity)
        : data_(std::make_unique<T[]>(capacity)), size_(0), capacity_(capacity) {}

    /// Get element at index with bounds checking.
    /// @param idx Index
    /// @return Reference to element
    /// @throws std::out_of_range if idx >= size
    T& at(std::size_t idx) {
        if (idx >= size_) throw std::out_of_range("Index out of bounds");
        return data_[idx];
    }

private:
    std::unique_ptr<T[]> data_;
    std::size_t size_, capacity_;
};
```

### Error Handling: std::expected
```cpp
/// Parse integer from string with detailed error reporting.
/// @param str Input string
/// @return Value on success, error message on failure
template<typename T>
requires std::integral<T>
[[nodiscard]] std::expected<T, std::string> parse_int(std::string_view str) noexcept {
    try {
        return static_cast<T>(std::stoll(std::string(str)));
    } catch (const std::invalid_argument& e) {
        return std::unexpected(std::string(e.what()));
    }
}
```

### Advanced: Concepts + Smart Pointers
```cpp
/// Type that can be serialized to JSON.
template<typename T>
concept Serializable = requires(const T& t) {
    { t.to_json() } -> std::convertible_to<std::string>;
};

/// Polymorphic serializer with concept enforcement.
template<Serializable T>
class Serializer {
    std::shared_ptr<T> resource_;
public:
    explicit Serializer(std::shared_ptr<T> res) : resource_(res) {}
    std::string serialize() const noexcept { return resource_->to_json(); }
};
```

---

## Comment Template (Doxygen)

### Function:
```cpp
/// Brief description (one line, ends with period).
/// @param param1 Description of first parameter
/// @param param2 Description of second parameter
/// @return Description of return value
/// @throws std::exception If specific error occurs
/// @note Optional implementation notes or warnings
/// @see Related_function, RelatedClass
```

### Class:
```cpp
/// @brief Brief one-line description.
/// @details Extended explanation with context and usage examples.
/// @tparam T Template parameter description
/// @warning Any critical usage warnings
/// @see RelatedClass, RelatedConcept
```

### File Header:
```cpp
/// @file filename.hpp
/// @brief Module purpose in one sentence.
/// @author QE Framework
/// @date YYYY-MM-DD
```

---

## Lint Rules

**Static Analysis:**
```bash
clang-tidy {file} -checks='*,-modernize-*,-readability-magic-numbers'
clang-tidy {file} -checks='*' --fix
clang-format -i {file}
cppcheck {file} --enable=all --suppress=missingIncludeSystem
```

**Config Files** (place in project root):
- `.clang-tidy` — Static analysis rules (readability, performance, safety)
- `.clang-format` — Indentation (2 spaces), line length (100), LLVM style
- `.cppcheck` — Enable all checks, suppress system includes

---

## Security Checklist

1. **Buffer Overflow** — Always use `std::vector<T>`, `std::array<T, N>`, or `std::string`; never `char*` for unbounded data
2. **Use-After-Free** — Use `std::unique_ptr<T>` and `std::shared_ptr<T>`; never manually delete
3. **Integer Overflow** — Use `std::numeric_limits<T>::max()`; validate arithmetic operations
4. **Format String Attacks** — Never pass user input directly to `printf()`, `sprintf()`, or `format()` as format string
5. **Uninitialized Memory** — Always initialize members in constructor; avoid `= {}` for non-trivial types unless intentional

---

## Anti-patterns (Wrong → Correct)

| Anti-pattern | Why Bad | Correct Approach |
|--------------|---------|------------------|
| `new T()` / `delete ptr` | Manual memory management, leak-prone | Use `std::make_unique<T>()` / `std::make_shared<T>()` |
| `(MyType*)ptr` | Unsafe cast, bypasses type system | Use `static_cast<>()` or `dynamic_cast<>()` with error handling |
| `using namespace std;` in headers | Name pollution, breaks downstream code | `std::` prefix or targeted `using std::vector;` in .cpp only |
| Magic numbers (e.g., `if (x > 100)`) | Unmaintainable, no context | Define `constexpr auto MAX_RETRIES = 100;` |
| Deep inheritance chains (3+ levels) | Brittle, tight coupling, hard to reason about | Prefer composition: `class Has-A { std::unique_ptr<Base> impl_; }` |
