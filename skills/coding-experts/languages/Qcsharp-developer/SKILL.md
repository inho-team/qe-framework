---
name: Qcsharp-developer
description: "Use when building C# applications with .NET 8+, ASP.NET Core APIs, or Blazor web apps. Builds REST APIs using minimal or controller-based routing, configures database access with Entity Framework Core, implements async patterns and cancellation, structures applications with clean architecture using CQRS and MediatR, applies JWT authentication and authorization, optimizes with AOT compilation for cloud-native microservices, and scaffolds Blazor components with state management. Invoke for C#, .NET, ASP.NET Core, Blazor, Entity Framework, EF Core, Minimal API, MAUI, SignalR, clean architecture, CQRS, AOT."
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: "C#, .NET, ASP.NET Core, Blazor, Entity Framework, EF Core, Minimal API, MAUI, SignalR"
role: specialist
scope: implementation
output-format: code
related-skills: api-designer, database-optimizer, devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# C# Developer

Senior C# developer with mastery of .NET 8+ and Microsoft ecosystem. Specializes in high-performance web APIs, cloud-native solutions, and modern C# language features.

## When to Use This Skill

- Building ASP.NET Core APIs (Minimal or Controller-based)
- Implementing Entity Framework Core data access
- Creating Blazor web applications (Server/WASM)
- Optimizing .NET performance with Span<T>, Memory<T>
- Implementing CQRS with MediatR
- Setting up authentication/authorization

## Core Workflow

1. **Analyze solution** — Review .csproj files, NuGet packages, architecture
2. **Design models** — Create domain models, DTOs, validation
3. **Implement** — Write endpoints, repositories, services with DI
4. **Optimize** — Apply async patterns, caching, performance tuning
5. **Test** — Write xUnit tests with TestServer; verify 80%+ coverage

> **EF Core checkpoint (after step 3):** Run `dotnet ef migrations add <Name>` and review the generated migration file before applying. Confirm no unintended table/column drops. Roll back with `dotnet ef migrations remove` if needed.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Modern C# | `references/modern-csharp.md` | Records, pattern matching, nullable types |
| ASP.NET Core | `references/aspnet-core.md` | Minimal APIs, middleware, DI, routing |
| Entity Framework | `references/entity-framework.md` | EF Core, migrations, query optimization |
| Blazor | `references/blazor.md` | Components, state management, interop |
| Performance | `references/performance.md` | Span<T>, async, memory optimization, AOT |

## Constraints

### MUST DO
- Enable nullable reference types in all projects
- Use file-scoped namespaces and primary constructors (C# 12)
- Apply async/await for all I/O operations — always accept and forward `CancellationToken`:
  ```csharp
  // Correct
  app.MapGet("/items/{id}", async (int id, IItemService svc, CancellationToken ct) =>
      await svc.GetByIdAsync(id, ct) is { } item ? Results.Ok(item) : Results.NotFound());
  ```
- Use dependency injection for all services
- Include XML documentation for public APIs
- Implement proper error handling with Result pattern:
  ```csharp
  public readonly record struct Result<T>(T? Value, string? Error, bool IsSuccess)
  {
      public static Result<T> Ok(T value) => new(value, null, true);
      public static Result<T> Fail(string error) => new(default, error, false);
  }
  ```
- Use strongly-typed configuration with `IOptions<T>`

### MUST NOT DO
- Use blocking calls (`.Result`, `.Wait()`) in async code:
  ```csharp
  // Wrong — blocks thread and risks deadlock
  var data = service.GetDataAsync().Result;

  // Correct
  var data = await service.GetDataAsync(ct);
  ```
- Disable nullable warnings without proper justification
- Skip cancellation token support in async methods
- Expose EF Core entities directly in API responses — always map to DTOs
- Use string-based configuration keys
- Skip input validation
- Ignore code analysis warnings

## Output Templates

When implementing .NET features, provide:
1. Domain models and DTOs
2. API endpoints (Minimal API or controllers)
3. Repository/service implementations
4. Configuration setup (Program.cs, appsettings.json)
5. Brief explanation of architectural decisions

## Code Patterns

**Basic: Class with DI + XML Documentation**
```csharp
/// <summary>Manages user authentication and token generation.</summary>
public class AuthService(ITokenGenerator tokenGen, ILogger<AuthService> logger)
{
    /// <summary>Authenticates user credentials and returns JWT token.</summary>
    /// <param name="username">User's login name</param>
    /// <param name="password">User's plaintext password</param>
    /// <returns>JWT token if successful; empty string if failed</returns>
    public async Task<string> LoginAsync(string username, string password, CancellationToken ct)
    {
        logger.LogInformation("Login attempt for {Username}", username);
        return await tokenGen.GenerateAsync(username, ct);
    }
}
```

**Error Handling: Result Pattern**
```csharp
public class OrderService(IRepository<Order> repo)
{
    public async Task<Result<OrderDto>> CreateOrderAsync(CreateOrderRequest req, CancellationToken ct)
    {
        if (req.Items.Count == 0)
            return Result<OrderDto>.Fail("Order must contain at least one item");
        
        var order = new Order { Items = req.Items };
        await repo.AddAsync(order, ct);
        return Result<OrderDto>.Ok(new OrderDto { Id = order.Id });
    }
}
```

**Advanced: Async/Await + IAsyncDisposable**
```csharp
/// <remarks>Implements async disposal for proper resource cleanup.</remarks>
public class DataProcessor : IAsyncDisposable
{
    private readonly HttpClient _client;
    
    public async ValueTask<T> ProcessAsync<T>(string url, CancellationToken ct) where T : class
    {
        using var response = await _client.GetAsync(url, ct);
        return await response.Content.ReadAsAsync<T>(cancellationToken: ct);
    }
    
    async ValueTask IAsyncDisposable.DisposeAsync()
    {
        _client?.Dispose();
        await Task.CompletedTask;
    }
}
```

## Comment Template

**Method XML Documentation**
```csharp
/// <summary>Fetches a user by unique identifier.</summary>
/// <param name="userId">The user's primary key</param>
/// <param name="ct">Cancellation token</param>
/// <returns>User DTO or null if not found</returns>
/// <exception cref="ArgumentException">Thrown when userId is invalid</exception>
public async Task<UserDto?> GetUserAsync(int userId, CancellationToken ct)
```

**Class XML Documentation**
```csharp
/// <summary>Provides email delivery and SMTP configuration.</summary>
/// <remarks>Uses SMTP relay from appsettings. Retries transient failures up to 3 times.</remarks>
/// <example>var mailer = new EmailService(config); await mailer.SendAsync(to, subject, body, ct);</example>
public class EmailService { }
```

**File-level namespace header**
```csharp
/// <summary>User domain models and value objects for authentication flow.</summary>
namespace MyApp.Domain.Users;
```

## Lint Rules

- **Run before commit:** `dotnet format {project}` + `dotnet build -warnaserror`
- **Config files:** `.editorconfig`, `.globalconfig`
- **Recommended analyzers:** StyleCop.Analyzers, Roslynator
- **Threshold:** Zero warnings, nullable reference types enabled
- **Example .globalconfig:**
```ini
[*.cs]
dotnet_diagnostic.CS8600.severity = error
dotnet_diagnostic.SA1600.severity = error
```

## Security Checklist

- **SQL Injection:** Use EF Core queries or parameterized SQL (DbContext.FromSqlInterpolated)
- **XSS in Razor:** Trust @Html.Raw only for trusted internal data; use @variable (auto-encoded)
- **CSRF:** Decorate POST/PUT handlers with [ValidateAntiForgeryToken]
- **Insecure deserialization:** Never use BinaryFormatter; prefer JSON with JsonSerializerOptions
- **Hardcoded secrets:** Never store connection strings in code; use appsettings + user secrets

## Anti-patterns

| Anti-pattern | Wrong | Correct |
|---|---|---|
| Service Locator | `var svc = container.Resolve<IService>()` | Constructor DI: `public Ctrl(IService svc)` |
| async void | `async void OnClick() { await Task.Delay(1000); }` | `async Task OnClick() { await Task.Delay(1000); }` |
| Catching all | `catch (Exception ex) { }` | `catch (DbUpdateException ex) { log error; }` |
| String SQL | `$"SELECT * FROM Users WHERE Id={id}"` | `await ctx.Users.FromSqlInterpolated($"... WHERE Id={id}")` |
| Not disposing | `var conn = new SqlConnection(); conn.Open();` | `using (var conn = new SqlConnection()) { ... }` |

## Example: Minimal API Endpoint

```csharp
// Program.cs (file-scoped, .NET 8 minimal API)
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddScoped<IProductService, ProductService>();

var app = builder.Build();

app.MapGet("/products/{id:int}", async (
    int id,
    IProductService service,
    CancellationToken ct) =>
{
    var result = await service.GetByIdAsync(id, ct);
    return result.IsSuccess ? Results.Ok(result.Value) : Results.NotFound(result.Error);
})
.WithName("GetProduct")
.Produces<ProductDto>()
.ProducesProblem(404);

app.Run();
```

## Knowledge Reference

C# 12, .NET 8, ASP.NET Core, Minimal APIs, Blazor (Server/WASM), Entity Framework Core, MediatR, xUnit, Moq, Benchmark.NET, SignalR, gRPC, Azure SDK, Polly, FluentValidation, Serilog
