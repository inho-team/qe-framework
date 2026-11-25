# Dependency Injection — 서비스 주입

## 목적

객체가 필요한 서비스를 생성자에 드러내고, 애플리케이션 구성 지점에서 구현과 수명을 정한다. 사용하는 코드가 서비스의 생성 절차를 알 필요가 줄어든다.

## 사용처

서비스에 여러 구현이 필요하거나 같은 인스턴스를 요청 안에서 공유할 때 적용한다. 의존성이 적고 수명이 단순하면 구성 지점에서 생성자를 직접 호출해도 된다.

## 장단점

생성자 주입을 통해 의존성을 쉽게 파악하고 테스트 대역을 전달할 수 있다. 컨테이너를 쓰면 등록과 수명 정보도 확인해야 한다. Singleton이 Scoped 인스턴스를 붙들면 요청 데이터가 섞이거나 해제된 자원에 접근할 수 있다.

## 구현 방식

기존 등록 지점에서 인터페이스와 구현을 연결한다. Transient는 해석 때 새 인스턴스를 제공하고, Scoped는 스코프 내에서 공유하며, Singleton은 컨테이너 수명 동안 공유한다. 컨테이너가 생성한 `IDisposable` 서비스는 해당 스코프 또는 컨테이너의 종료에서 해제한다. 외부에서 생성하여 인스턴스로 등록한 객체의 해제는 등록자가 맡는다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 생성자에 독립적으로 교체할 서비스 전달

마감일 안내 서비스에 오늘 날짜를 공급한다. 검증에서는 날짜를 고정한 대역을 전달한다.

```csharp
var reminder = new DueReminder(new FixedDateSource(new DateOnly(2030, 4, 3)));
if (reminder.DaysLeft(new DateOnly(2030, 4, 5)) != 2)
    throw new InvalidOperationException("Expected two remaining days");

interface IDateSource
{
    DateOnly Today { get; }
}

sealed record FixedDateSource(DateOnly Today) : IDateSource;

sealed class DueReminder(IDateSource dates)
{
    public int DaysLeft(DateOnly due) => due.DayNumber - dates.Today.DayNumber;
}
```

실행하면 마감일까지 2일이 남는다. 기준 날짜를 바꾼 대역을 전달하면 같은 서비스에 다른 날짜를 적용할 수 있다.

### 사례 2 — ASP.NET Core에서 요청 스코프로 등록

ASP.NET Core .NET 8 웹 프로젝트를 사용한다. 기본 요청 서비스 프로바이더가 관리하는 스코프에서 요청 ID 객체를 공유한다. 서비스의 해제는 프레임워크가 맡는다.

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddScoped<RequestStamp>();
builder.Services.AddScoped<ReceiptHandler>();

var app = builder.Build();
app.MapGet("/receipt", (HttpContext context, ReceiptHandler handler, RequestStamp stamp) =>
{
    var fromRequest = context.RequestServices.GetRequiredService<RequestStamp>();
    if (!ReferenceEquals(stamp, fromRequest) || !ReferenceEquals(stamp, handler.Stamp))
        throw new InvalidOperationException("Scoped service was not shared");

    return stamp.Id.ToString("D");
});
app.Run();

sealed class RequestStamp
{
    public Guid Id { get; } = Guid.NewGuid();
}

sealed class ReceiptHandler(RequestStamp stamp)
{
    public RequestStamp Stamp { get; } = stamp;
}
```

`dotnet run --no-build --no-launch-profile -- --urls http://127.0.0.1:5080`로 실행한다. `/receipt`를 두 번 호출해 두 응답이 200이고 서로 다른 GUID를 담는지 확인한다. 각 요청에서는 엔드포인트와 생성자가 받은 참조가 같은지도 검사한다.

### 사례 3 — Singleton에 Scoped가 포획되는 등록 검증

콘솔 프로젝트에 `Microsoft.AspNetCore.App` 프레임워크 참조를 추가한다. 동일한 Scoped 객체의 반복 해석과 스코프 종료 시 해제를 확인하고, 이어서 잘못된 Singleton 등록을 빌드 시점에 검사한다.

```csharp
using Microsoft.Extensions.DependencyInjection;

var services = new ServiceCollection();
services.AddScoped<RequestResource>();
using (var provider = services.BuildServiceProvider(new ServiceProviderOptions
       { ValidateOnBuild = true, ValidateScopes = true }))
{
    RequestResource resource;
    using (var scope = provider.CreateScope())
    {
        resource = scope.ServiceProvider.GetRequiredService<RequestResource>();
        if (!ReferenceEquals(resource, scope.ServiceProvider.GetRequiredService<RequestResource>()))
            throw new InvalidOperationException("Expected shared scope");
    }

    if (!resource.Disposed)
        throw new InvalidOperationException("Expected scoped disposal");
}

services.AddSingleton<InvalidCache>();
try
{
    using var invalid = services.BuildServiceProvider(new ServiceProviderOptions
        { ValidateOnBuild = true, ValidateScopes = true });
    throw new InvalidOperationException("Expected registration validation failure");
}
catch (AggregateException error) when (error.InnerExceptions.Count == 1 &&
    error.InnerExceptions[0].InnerException is InvalidOperationException)
{
}

sealed class RequestResource : IDisposable
{
    public bool Disposed { get; private set; }
    public void Dispose() => Disposed = true;
}

sealed class InvalidCache(RequestResource resource)
{
    public RequestResource Resource { get; } = resource;
}
```

정상 스코프를 닫으면 리소스가 해제된다. Singleton 구성을 추가하면 빌드 단계에서 `AggregateException`이 발생한다. 백그라운드 Singleton이 Scoped 서비스가 필요하면 작업마다 스코프를 만들고 그 안에서 서비스 사용을 끝낸다.

## 관련 문서

[Decorator](decorator.md)는 같은 계약을 구현하는 객체를 안쪽 서비스와 함께 등록할 수 있다. [Middleware](middleware.md)는 요청 스코프에 맞춰 서비스를 받는다. [Microsoft Learn의 .NET 의존성 주입](https://learn.microsoft.com/dotnet/core/extensions/dependency-injection/)
