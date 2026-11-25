# Decorator — 서비스 동작 확장

## 목적

같은 서비스 인터페이스를 구현한 래퍼가 실제 서비스 호출 전후에 계측이나 캐시를 적용한다. 실제 비즈니스 연산과 추가 동작을 별도로 관리한다.

## 사용처

서로 다른 구현에서 같은 부가 동작이 필요하거나 적용 여부를 구성으로 정할 때 쓴다. 한 메서드에만 필요한 짧은 보조 동작은 그 메서드 안에 두어도 된다.

## 장단점

호출부 수정 없이 구성을 바꿀 수 있다. 래퍼가 겹치면 순서에 따라 실제 계측 범위와 캐시 동작이 달라진다. 캐시는 공유 범위, 키의 정보, 만료, 동시에 캐시를 채우는 호출을 고려해야 한다.

## 구현 방식

안쪽 서비스와 바깥 서비스가 같은 인터페이스를 구현하게 한다. 안쪽 서비스의 결과, 예외와 `CancellationToken`을 유지한다. DI 등록에서는 바깥 서비스의 팩터리가 같은 서비스 키를 재해석하지 않도록 안쪽 구현을 구체 타입이나 별도 키로 등록한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 서비스 호출 시간 기록

카탈로그에 실행 시간 기록을 추가한다. `record`는 예외가 없는 기록 함수로 한정하고, 테스트 대역은 파일이나 네트워크에 접근하지 않는다.

```csharp
using System.Diagnostics;

var measurements = new List<TimeSpan>();
ICatalog catalog = new TimedCatalog(new MemoryCatalog(), measurements.Add);
using var source = new CancellationTokenSource();

if (await catalog.GetNameAsync("A", source.Token) != "name-A" ||
    measurements.Count != 1 || measurements[0] < TimeSpan.Zero)
    throw new InvalidOperationException("Unexpected result or measurement");

interface ICatalog
{
    Task<string> GetNameAsync(string id, CancellationToken token);
}

sealed class MemoryCatalog : ICatalog
{
    public Task<string> GetNameAsync(string id, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        return Task.FromResult($"name-{id}");
    }
}

sealed class TimedCatalog(ICatalog inner, Action<TimeSpan> record) : ICatalog
{
    public async Task<string> GetNameAsync(string id, CancellationToken token)
    {
        var watch = Stopwatch.StartNew();
        try { return await inner.GetNameAsync(id, token); }
        finally { record(watch.Elapsed); }
    }
}
```

반환값은 `name-A`이고 기록은 정확히 한 건이다. 환경마다 실행 시간이 달라지므로 특정 소요 시간으로 검증하지 않는다.

### 사례 2 — 같은 계약으로 캐시 추가

단일 요청 안에서 두 번 읽는 지역 이름을 캐시한다. 예시의 인스턴스는 직렬 호출에 한정하며, 이름은 사용 중 변경되지 않는다.

```csharp
var source = new CountingDirectory();
IRegionDirectory directory = new CachedDirectory(source);
if (await directory.FindAsync(2, default) != "region-2" ||
    await directory.FindAsync(2, default) != "region-2" ||
    source.CallCount != 1)
    throw new InvalidOperationException("Expected one source lookup");

interface IRegionDirectory
{
    Task<string> FindAsync(int id, CancellationToken token);
}

sealed class CountingDirectory : IRegionDirectory
{
    public int CallCount { get; private set; }

    public Task<string> FindAsync(int id, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        CallCount++;
        return Task.FromResult($"region-{id}");
    }
}

sealed class CachedDirectory(IRegionDirectory inner) : IRegionDirectory
{
    private readonly Dictionary<int, string> cache = [];

    public async Task<string> FindAsync(int id, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (cache.TryGetValue(id, out var name))
            return name;

        name = await inner.FindAsync(id, token);
        cache[id] = name;
        return name;
    }
}
```

같은 키의 두 읽기는 같은 결과를 주고 안쪽 서비스는 한 번만 호출된다. 값을 얻는 데 실패하면 대입까지 진행하지 않는다. 병렬 호출을 지원할 때는 캐시의 쓰기와 중복 채우기 정책을 정한다.

### 사례 3 — 계측이 실패해도 원래 실패와 취소 보존

저장 서비스의 계측기가 예상된 종류의 예외를 던진다. 기록 실패가 저장 결과, 저장 장애, 취소 중 어느 것도 가리지 않는지 실행해서 확인한다.

```csharp
using System.Diagnostics;

var telemetryAttempts = 0;
var service = new RecordedStore(new LocalStore(), _ =>
{
    telemetryAttempts++;
    throw new InvalidOperationException("Metrics backend closed");
});

if (await service.SaveAsync("ok", default) != 2)
    throw new InvalidOperationException("Metrics changed a successful result");

try
{
    await service.SaveAsync("broken", default);
    throw new InvalidOperationException("Expected storage failure");
}
catch (IOException error) when (error.Message == "Write failed")
{
}

using var source = new CancellationTokenSource();
source.Cancel();
try
{
    await service.SaveAsync("cancel", source.Token);
    throw new InvalidOperationException("Expected cancellation");
}
catch (OperationCanceledException error) when (error.CancellationToken == source.Token)
{
}

if (telemetryAttempts != 3)
    throw new InvalidOperationException("Expected metrics for all outcomes");

interface IStore
{
    Task<int> SaveAsync(string text, CancellationToken token);
}

sealed class LocalStore : IStore
{
    public Task<int> SaveAsync(string text, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (text == "broken")
            throw new IOException("Write failed");
        return Task.FromResult(text.Length);
    }
}

sealed class RecordedStore(IStore inner, Action<TimeSpan> record) : IStore
{
    public async Task<int> SaveAsync(string text, CancellationToken token)
    {
        var watch = Stopwatch.StartNew();
        try
        {
            return await inner.SaveAsync(text, token);
        }
        finally
        {
            try { record(watch.Elapsed); }
            catch (InvalidOperationException) { }
        }
    }
}
```

저장 오류와 취소의 토큰이 호출부에 전달되고 성공 결과도 유지된다. 예시는 계측 함수가 계약상 내는 예외를 억제한다. 운영에서는 저장과 독립된 계측 수단에서 기록 누락을 관찰할 수 있다.

## 관련 문서

[Dependency Injection](dependency-injection.md)은 안쪽과 바깥쪽 서비스를 함께 구성할 때 쓴다. [Middleware](middleware.md)는 ASP.NET Core 요청 파이프라인에서 비슷한 호출 흐름을 만든다.
