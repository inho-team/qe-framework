# Adapter — 외부 계약 번역

## 목적

외부 라이브러리의 모델과 예외를 도메인 타입과 오류로 바꾼다. 외부 계약이 바뀌면 변환 코드에서 변경을 흡수한다.

## 사용처

공급자별 단위나 상태 표현, 실패 유형, 호출 방식이 내부 규약과 다를 때 도입한다. 같은 의미의 값을 한 번 변환하는 경우 작은 함수로 충분하다.

## 장단점

호출자가 외부 타입에 묶이지 않아 테스트와 공급자 교체가 수월하다. 변환 과정에서 단위, 오류 정보, 취소 의미를 잃기 쉽다. 동기 어댑터가 비동기 작업을 기다리면 스레드와 처리량을 사용한다.

## 구현 방식

내부 포트에 필요한 모델과 결과를 정의하고 SDK 호출과 변환을 어댑터가 맡는다. 문서화된 외부 실패만 매핑하고 예상하지 못한 예외는 전달한다. 비동기 API를 호출할 때 토큰과 시간 제한의 주체를 구분한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — SDK 모델과 예외를 내부 타입으로 변환

외부 재고 SDK는 센트 단위 정수로 가격을 주고, 공급자 고유 예외로 가용성 문제를 전달한다. SDK 호출은 인메모리 대역으로 실행한다.

```csharp
var adapter = new PriceAdapter(new VendorClient());
if (adapter.Read("book") != new Price("book", 12.50m))
    throw new InvalidOperationException("Price conversion failed");

try
{
    adapter.Read("offline");
    throw new InvalidOperationException("Expected an unavailable vendor");
}
catch (PriceUnavailable error) when (error.InnerException is VendorOffline)
{
}

sealed record Price(string Item, decimal Dollars);
sealed record VendorQuote(string ProductCode, int Cents);
sealed class VendorOffline : Exception;
sealed class PriceUnavailable(Exception cause) : Exception("Price unavailable", cause);

sealed class VendorClient
{
    public VendorQuote Fetch(string key) => key == "offline"
        ? throw new VendorOffline()
        : new VendorQuote(key, 1250);
}

sealed class PriceAdapter(VendorClient vendor)
{
    public Price Read(string item)
    {
        try
        {
            var quote = vendor.Fetch(item);
            return new Price(quote.ProductCode, quote.Cents / 100m);
        }
        catch (VendorOffline error)
        {
            throw new PriceUnavailable(error);
        }
    }
}
```

`book`을 읽으면 12.50달러로 변환된다. `offline`의 경우 내부 예외가 발생하고 원래 SDK 예외는 원인으로 남는다.

### 사례 2 — 동기 계약에서 비동기 라이브러리 호출

호출 계약을 바꿀 수 없는 콘솔 작업에 외부 비동기 이름 조회를 연결한다. 예시는 호출 스레드를 기다리게 하므로 별도 동기화 컨텍스트가 없는 제한된 진입점에서 실행한다.

```csharp
var legacy = new LegacyNameAdapter(new RemoteNames());
if (legacy.ReadName(6) != "item-6")
    throw new InvalidOperationException("Unexpected name");

interface ILegacyNameReader
{
    string ReadName(int id);
}

sealed class RemoteNames
{
    public async Task<string> ReadAsync(int id, CancellationToken token)
    {
        await Task.Delay(1, token).ConfigureAwait(false);
        return $"item-{id}";
    }
}

sealed class LegacyNameAdapter(RemoteNames remote) : ILegacyNameReader
{
    public string ReadName(int id)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        return remote.ReadAsync(id, timeout.Token).GetAwaiter().GetResult();
    }
}
```

서버 없이 실행해 `item-6`을 받는다. 동기화를 요구하는 UI 호출부나 처리량이 중요한 서버에서는 내부 계약도 비동기로 바꿀 수 있는지 검토한다. 호출부에서 기다리는 동안에도 SDK가 같은 스레드의 컨텍스트를 요구하면 교착될 수 있다.

### 사례 3 — 공급자 취소와 데이터 누락 구분

택배 조회 대역은 누락을 `null`로 표현하고 공급자 자체의 시간 초과는 별도 토큰으로 취소한다. 어댑터는 호출자의 취소를 우선하며, 누락과 공급자 시간 초과는 별도의 결과로 변환한다.

```csharp
using var request = new CancellationTokenSource();
var adapter = new TrackingAdapter(new VendorTracking());
if (await adapter.FindAsync("absent", request.Token) != TrackingStatus.Missing ||
    await adapter.FindAsync("timeout", request.Token) != TrackingStatus.SupplierTimedOut)
    throw new InvalidOperationException("Vendor states were combined");

request.Cancel();
try
{
    await adapter.FindAsync("absent", request.Token);
    throw new InvalidOperationException("Expected caller cancellation");
}
catch (OperationCanceledException error) when (error.CancellationToken == request.Token)
{
}

using var overlap = new CancellationTokenSource();
var overlappingAdapter = new TrackingAdapter(new VendorTracking(overlap.Cancel));
try
{
    await overlappingAdapter.FindAsync("timeout", overlap.Token);
    throw new InvalidOperationException("Expected caller cancellation during supplier timeout");
}
catch (OperationCanceledException error)
{
    if (error.CancellationToken != overlap.Token)
        throw new InvalidOperationException("Supplier token escaped", error);
}

enum TrackingStatus { Found, Missing, SupplierTimedOut }

sealed class TrackingAdapter(VendorTracking vendor)
{
    public async Task<TrackingStatus> FindAsync(string id, CancellationToken token)
    {
        try
        {
            return await vendor.FindAsync(id, token) is null
                ? TrackingStatus.Missing
                : TrackingStatus.Found;
        }
        catch (OperationCanceledException)
        {
            token.ThrowIfCancellationRequested();
            return TrackingStatus.SupplierTimedOut;
        }
    }
}

sealed class VendorTracking(Action? onSupplierTimeout = null)
{
    public Task<string?> FindAsync(string id, CancellationToken token)
    {
        if (token.IsCancellationRequested)
            return Task.FromCanceled<string?>(token);
        if (id == "timeout")
        {
            var timeout = Task.FromCanceled<string?>(new CancellationToken(canceled: true));
            onSupplierTimeout?.Invoke();
            return timeout;
        }
        return Task.FromResult<string?>(id == "absent" ? null : id);
    }
}
```

검증은 누락, 공급자 시간 초과, 호출자 취소를 각각 확인한다. 두 취소가 겹치는 경로에서는 대역이 공급자 작업을 취소한 직후 호출자 토큰을 취소한다. 이때 어댑터가 호출자 토큰으로 취소를 전달하는지 확인한다. 시간 초과 매핑은 공급자의 독립 취소 원인이 시간 초과라는 이 대역의 계약에 의존한다.

## 관련 문서

[Repository](repository.md)는 공급자 변환을 넘어서 도메인 질의와 실행 범위를 정의한다. [Decorator](decorator.md)는 기존 타입의 계약을 유지한 채 동작을 추가한다.
