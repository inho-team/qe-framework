# Repository — 도메인 저장소 경계

## 목적

도메인이 필요로 하는 조회와 저장 동작을 이름 있는 메서드로 제공한다. 쿼리 구성, 실행 시점, 조회 결과의 소유권을 저장소에서 관리한다.

## 사용처

여러 호출부가 같은 업무 질의를 사용하거나 조회와 수정의 경계가 반복될 때 도입한다. 얇은 전달 메서드만 더하는 경우에는 기존 `DbContext`를 애플리케이션 경계에서 직접 사용하는 방식으로도 충분하다.

## 장단점

공급자와 쿼리 제약을 한곳에서 다룰 수 있다. 지나치게 일반적인 CRUD 인터페이스는 도메인 의도를 잃기 쉽고, 모든 질의를 미리 만들어야 하면 표현력이 떨어진다. 결과를 한 번에 구체화하면 필요한 데이터 규모만큼 메모리가 든다.

## 구현 방식

메서드에 조건과 결과 타입을 표현한다. EF Core 읽기에서는 필요한 열을 투영하고 정해진 범위에서 `ToListAsync` 등으로 쿼리를 실행한다. 수정 작업에서는 사용할 `DbContext`와 커밋 단위를 정한다. `IQueryable`을 그대로 반환하면 지연 실행, LINQ 변환 제약, 컨텍스트 수명을 호출자가 판단해야 한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 도메인 질의에 필요한 연산 노출

미결제 송장의 마감 알림을 만들 때 기준일 이전의 미결제 송장만 필요하다. 저장소 대역은 완성된 결과를 반환한다.

```csharp
IInvoiceRepository invoices = new MemoryInvoices([
    new Invoice(1, new DateOnly(2030, 4, 1), false),
    new Invoice(2, new DateOnly(2030, 4, 1), true),
    new Invoice(3, new DateOnly(2030, 4, 8), false)
]);
var overdue = invoices.FindOverdue(new DateOnly(2030, 4, 5));
if (!overdue.Select(invoice => invoice.Id).SequenceEqual([1]))
    throw new InvalidOperationException("Only unpaid overdue invoices are expected");

sealed record Invoice(int Id, DateOnly Due, bool Paid);

interface IInvoiceRepository
{
    IReadOnlyList<Invoice> FindOverdue(DateOnly today);
}

sealed class MemoryInvoices(IEnumerable<Invoice> invoices) : IInvoiceRepository
{
    private readonly Invoice[] all = invoices.ToArray();

    public IReadOnlyList<Invoice> FindOverdue(DateOnly today) =>
        all.Where(invoice => !invoice.Paid && invoice.Due < today)
            .OrderBy(invoice => invoice.Id)
            .ToArray();
}
```

실행하면 기한이 지나고 결제하지 않은 1번만 반환된다. 저장소 계약의 기준일은 당일을 포함하지 않는다.

### 사례 2 — EF Core 조회의 추적 범위 제어

콘솔 프로젝트에 `dotnet add package Microsoft.EntityFrameworkCore.InMemory --version 8.0.11`로 EF Core 8 공급자를 추가한다. 시드 작업과 조회에 별도의 컨텍스트를 쓰고, 읽기 전용 조회와 수정 조회를 구분한다. 인메모리 공급자로 추적 계약을 확인한다.

```csharp
using Microsoft.EntityFrameworkCore;

var options = new DbContextOptionsBuilder<OrdersContext>()
    .UseInMemoryDatabase("orders")
    .Options;
await using (var seed = new OrdersContext(options))
{
    seed.Orders.Add(new Order { Id = 7, Open = true });
    await seed.SaveChangesAsync();
}

await using var db = new OrdersContext(options);
using var source = new CancellationTokenSource();
var repository = new OrdersRepository(db);
var open = await repository.FindOpenAsync(source.Token);
if (open.Count != 1 || open[0].Id != 7 || db.ChangeTracker.Entries<Order>().Any())
    throw new InvalidOperationException("Read-only query must not add tracked entries");

var tracked = await repository.FindForUpdateAsync(7, source.Token)
    ?? throw new InvalidOperationException("Expected the seeded order");
tracked.Open = false;
if (db.Entry(tracked).State != EntityState.Modified)
    throw new InvalidOperationException("Update query should track changes");

sealed class Order
{
    public int Id { get; set; }
    public bool Open { get; set; }
}

sealed class OrdersContext(DbContextOptions<OrdersContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
}

sealed class OrdersRepository(OrdersContext db)
{
    public async Task<IReadOnlyList<Order>> FindOpenAsync(CancellationToken token) =>
        await db.Orders.AsNoTracking().Where(order => order.Open)
            .OrderBy(order => order.Id).ToListAsync(token);

    public Task<Order?> FindForUpdateAsync(int id, CancellationToken token) =>
        db.Orders.AsTracking().SingleOrDefaultAsync(order => order.Id == id, token);
}
```

조회용 메서드를 호출해도 추적 항목이 생기지 않는다. 수정 조회 결과의 속성을 바꾸면 상태가 `Modified`가 된다. 이 예시는 저장을 호출하지 않으며, 관계형 공급자의 SQL 변환은 실제 공급자를 사용해 별도로 검증한다.

### 사례 3 — IQueryable 노출과 실행 시점

사례 2와 같은 EF Core 8 인메모리 공급자를 추가한다. 조회를 구체화할 때와 `IQueryable`을 그대로 반환할 때의 차이를 같은 데이터로 확인한다.

```csharp
using Microsoft.EntityFrameworkCore;

var options = new DbContextOptionsBuilder<BooksContext>()
    .UseInMemoryDatabase("books")
    .Options;
IQueryable<Book> deferred;
IReadOnlyList<int> materialized;

await using (var db = new BooksContext(options))
{
    db.Books.Add(new Book { Id = 3 });
    await db.SaveChangesAsync();

    var repository = new BooksRepository(db);
    deferred = repository.All().Where(book => book.Id > 1);
    materialized = await repository.GetIdsAsync(CancellationToken.None);
}

if (!materialized.SequenceEqual([3]))
    throw new InvalidOperationException("Materialized result lost its value");

try
{
    await deferred.ToListAsync();
    throw new InvalidOperationException("Expected a disposed DbContext");
}
catch (ObjectDisposedException)
{
}

sealed class Book
{
    public int Id { get; set; }
}

sealed class BooksContext(DbContextOptions<BooksContext> options) : DbContext(options)
{
    public DbSet<Book> Books => Set<Book>();
}

sealed class BooksRepository(BooksContext db)
{
    public IQueryable<Book> All() => db.Books.AsNoTracking();

    public async Task<IReadOnlyList<int>> GetIdsAsync(CancellationToken token) =>
        await db.Books.OrderBy(book => book.Id).Select(book => book.Id).ToListAsync(token);
}
```

컨텍스트가 닫힌 뒤에도 구체화해 둔 ID는 읽을 수 있다. 뒤늦게 `ToListAsync`로 실행한 `IQueryable`은 해제된 컨텍스트에 접근하여 `ObjectDisposedException`을 낸다. 이 반환 형태는 호출자가 공급자가 번역할 수 있는 식도 알아야 한다.

## 관련 문서

[Adapter](adapter.md)는 외부 인터페이스를 내부 타입과 오류로 번역할 때 쓴다. [Dependency Injection](dependency-injection.md)은 저장소와 컨텍스트에 같은 스코프를 제공할 수 있다. [Microsoft Learn의 EF Core 쿼리 추적 동작](https://learn.microsoft.com/ef/core/querying/tracking)
