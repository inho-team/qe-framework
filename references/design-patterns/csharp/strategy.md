# Strategy — 정책 교체

## 목적

같은 입력에 여러 계산 정책을 적용할 때 호출 절차와 정책의 결정을 분리한다. 호출자는 어떤 정책을 쓸지 정하고, 전략은 정해진 계약에 따라 결과를 계산한다.

## 사용처

가격표나 유효성 검사 규칙이 자주 추가되고 독립적으로 테스트해야 할 때 도입한다. 업무 분기가 한 곳에 머물고 규칙이 짧다면 메서드 안의 조건문으로도 충분하다.

## 장단점

단일 연산은 델리게이트로 가볍게 연결할 수 있고 구현마다 독립된 테스트를 붙일 수 있다. 정책 수가 늘면 선택 기준과 기본값을 관리해야 한다. 상태를 캡처한 델리게이트를 여러 요청에서 공유하면 해당 상태의 스레드 안전성도 확인해야 한다.

## 구현 방식

연산 하나에는 `Func<…>`나 이름 있는 델리게이트를 사용한다. 관련 연산이 함께 바뀌면 인터페이스로 묶는다. 비동기 정책에는 결과형과 `CancellationToken`을 계약으로 명시하고, 정책별 실패를 어떤 결과 또는 예외로 전달할지 결정한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 가격 계산 델리게이트 선택

주문 채널에 따라 같은 주문 금액에서 할인 여부를 결정한다. 가격 계산은 호출부와 독립된 델리게이트다.

```csharp
var order = new Order(120m);
Func<Order, decimal> standard = order => order.Subtotal;
Func<Order, decimal> member = order => order.Subtotal * 0.90m;

if (Quote(order, standard) != 120m || Quote(order, member) != 108m)
    throw new InvalidOperationException("Incorrect quotes");

static decimal Quote(Order order, Func<Order, decimal> policy) => policy(order);

record Order(decimal Subtotal);
```

실행하면 동일한 주문에 일반가 120과 회원가 108이 적용된다. 검증은 두 전략의 반환값을 각각 비교한다.

### 사례 2 — 비동기 정책에 취소 전달

배송 계획 조회 정책에 취소를 전달한다. 테스트 대역은 진입을 알린 뒤 취소를 기다려 타이밍에 의존하지 않는다.

```csharp
using var source = new CancellationTokenSource();
var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var pending = SelectAsync("S-10", WaitForRoutingAsync, source.Token);
await entered.Task;
source.Cancel();

try
{
    await pending;
    throw new InvalidOperationException("Expected cancellation");
}
catch (OperationCanceledException error) when (error.CancellationToken == source.Token)
{
}

async Task<string> WaitForRoutingAsync(string shipment, CancellationToken token)
{
    entered.SetResult();
    await Task.Delay(Timeout.InfiniteTimeSpan, token);
    return shipment;
}

static Task<string> SelectAsync(string shipment, RoutePolicy policy, CancellationToken token)
    => policy(shipment, token);

delegate Task<string> RoutePolicy(string shipment, CancellationToken token);
```

실행하면 조회 작업이 요청 토큰으로 취소된다. 검증은 정책에 전달된 토큰으로 발생한 취소를 확인한다.

### 사례 3 — 거절 결과와 정책 장애 계약

환불 정책은 승인 여부를 결과로 반환한다. 정책에 필요한 환율을 읽지 못하면 호출부가 재시도 여부를 판단할 수 있도록 실패 예외를 전달한다.

```csharp
if (Decide(new ExpiredRefundPolicy(), 100m) != RefundDecision.OutsideWindow)
    throw new InvalidOperationException("Expected a business decision");

try
{
    Decide(new OfflineExchangePolicy(), 100m);
    throw new InvalidOperationException("Expected a policy failure");
}
catch (IOException error) when (error.Message == "Rate feed unavailable")
{
}

static RefundDecision Decide(IRefundPolicy policy, decimal amount) => policy.Evaluate(amount);

enum RefundDecision { Approved, OutsideWindow }

interface IRefundPolicy
{
    RefundDecision Evaluate(decimal amount);
}

sealed class ExpiredRefundPolicy : IRefundPolicy
{
    public RefundDecision Evaluate(decimal amount) => RefundDecision.OutsideWindow;
}

sealed class OfflineExchangePolicy : IRefundPolicy
{
    public RefundDecision Evaluate(decimal amount) => throw new IOException("Rate feed unavailable");
}
```

실행하면 기간이 지난 주문은 `OutsideWindow`로 처리되고 환율 조회 장애는 `IOException`으로 전달된다. 검증은 정상적인 업무 거절과 장애가 서로 다른 경로를 지나는지 확인한다.

## 관련 문서

[Dependency Injection](dependency-injection.md)은 전략의 수명과 제공 위치를 관리할 수 있다. [Factory](factory.md)는 조건에 따라 어떤 전략 인스턴스를 만들지 정할 수 있다.
