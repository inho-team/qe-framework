# Middleware — HTTP 요청 파이프라인

## 목적

ASP.NET Core에서 여러 엔드포인트에 공통인 HTTP 동작을 요청 파이프라인에 조립한다. 미들웨어는 다음 단계로 진행하기 전후에 일을 하거나 응답을 만들어 요청을 끝낸다.

## 사용처

요청 추적, 인증, 공통 오류 처리처럼 여러 경로가 같은 HTTP 규칙을 공유할 때 쓴다. 엔드포인트 하나에만 해당하는 업무 판단은 그 엔드포인트에서 처리해도 된다.

## 장단점

공통 규칙을 한 곳에 적용할 수 있다. 등록 순서가 결과를 바꾸며, 조기 반환은 뒤에 등록한 미들웨어를 건너뛴다. 응답이 시작된 뒤에는 상태 코드나 헤더를 수정할 수 없다.

## 구현 방식

`Use`에서 다음 델리게이트를 호출하고 `Run`에서 파이프라인을 끝낸다. 예외 처리는 보호할 단계 앞에 둔다. 헤더를 응답 직전에 계산해야 하면 다음 단계 호출 전에 `OnStarting`을 등록한다. 일반 클래스 기반 미들웨어에서 요청별 서비스는 `InvokeAsync` 매개변수로 받는다. `IMiddleware`를 쓰면 요청마다 활성화한 객체의 생성자로 Scoped 서비스를 받을 수 있다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 추적 식별자와 처리 시간 남기기

ASP.NET Core .NET 8 웹 프로젝트를 사용한다. 요청마다 식별자와 시작 시간을 읽고 애플리케이션 로거로 완료 시간을 남긴다. 시간과 식별자는 해당 요청에서만 사용한다.

```csharp
using System.Diagnostics;

var app = WebApplication.CreateBuilder(args).Build();

app.Use(async (context, next) =>
{
    var trace = context.TraceIdentifier;
    var watch = Stopwatch.StartNew();
    context.Response.Headers["X-Trace-Id"] = trace;

    try
    {
        await next(context);
    }
    finally
    {
        app.Logger.LogInformation("Request {TraceId} took {ElapsedMs}ms",
            trace, watch.Elapsed.TotalMilliseconds);
    }
});

app.MapGet("/ping", () => "pong");
app.Run();
```

`dotnet run --no-build --no-launch-profile -- --urls http://127.0.0.1:5080`로 실행한다. `curl -i http://127.0.0.1:5080/ping`의 상태가 200이고 본문이 `pong`인지 확인한다. 응답의 `X-Trace-Id`와 서버 로그의 `TraceId`가 일치해야 한다. Windows PowerShell에서는 `curl.exe`를 사용한다.

### 사례 2 — 예외 처리, 인증, 인가 순서 조립

ASP.NET Core .NET 8 웹 프로젝트를 사용한다. 인증 라이브러리의 테스트 대역이 사용자 또는 실패를 제공하고, 파이프라인이 인증 뒤에 인가를 적용한다. 헤더 대역은 로컬 실행에서만 사용한다.

```csharp
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAuthentication("Sample")
    .AddScheme<AuthenticationSchemeOptions, SampleAuthentication>("Sample", _ => { });
builder.Services.AddAuthorization();
var app = builder.Build();

app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsync("request failed", context.RequestAborted);
}));
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/account", (HttpContext context) => context.User.Identity!.Name!)
    .RequireAuthorization();
app.Run();

sealed class SampleAuthentication(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var credential = Request.Headers["X-Sample"].ToString();
        if (credential == "error")
            throw new IOException("Authentication backend unavailable");
        if (credential != "reader")
            return Task.FromResult(AuthenticateResult.NoResult());

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, "reader")], Scheme.Name);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
```

사례 1과 같은 명령으로 실행한다. `/account`의 응답은 헤더가 없으면 401, `X-Sample: reader`이면 200과 `reader`, `X-Sample: error`이면 500과 `request failed`다. 예외 처리기가 인증의 실패를 잡고 인가가 인증 결과를 사용한다.

### 사례 3 — 응답 시작 뒤 헤더 수정과 조기 반환 확인

ASP.NET Core .NET 8 웹 프로젝트를 사용한다. 파이프라인에서 차단된 경로를 조기에 반환하고, 정상 경로에서는 응답 시작을 명시하여 헤더가 이미 전송된 상태를 확인한다.

```csharp
var app = WebApplication.CreateBuilder(args).Build();

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["X-Pipeline"] = "started";
        return Task.CompletedTask;
    });

    if (context.Request.Path == "/closed")
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsync("closed", context.RequestAborted);
        return;
    }

    await next(context);
    if (!context.Response.HasStarted)
        context.Response.Headers["X-Late"] = "set";
});

app.Run(async context =>
{
    context.Response.Headers["X-Endpoint"] = "reached";
    await context.Response.StartAsync(context.RequestAborted);
    try
    {
        context.Response.Headers["X-Too-Late"] = "invalid";
        throw new Exception("Expected the header write to be rejected");
    }
    catch (InvalidOperationException) when (context.Response.HasStarted)
    {
        await context.Response.WriteAsync("header was locked", context.RequestAborted);
    }
});

app.Run();
```

사례 1과 같은 명령으로 실행한다. `curl -i`로 `/closed`에서 503과 `closed`, `X-Pipeline: started`를 확인한다. `X-Endpoint`가 없어야 한다. `/open`은 200, `header was locked`, `X-Endpoint: reached`를 반환하며 `X-Too-Late`와 `X-Late`는 없어야 한다. 헤더 수정 시도는 실패를 재현하기 위한 것이다.

## 관련 문서

[Decorator](decorator.md)는 개별 서비스를 감싸고, [Dependency Injection](dependency-injection.md)은 미들웨어가 사용하는 서비스의 수명을 관리한다. [Microsoft Learn의 ASP.NET Core 미들웨어](https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/middleware?view=aspnetcore-8.0)
