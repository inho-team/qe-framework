# Observer — 상태 변화 전달

## 목적

발행자가 상태의 변화를 여러 구독자에게 전달한다. 각 구독자가 변화에 대응하는 방법을 정하고 발행자는 구독자 구현을 알 필요가 없다.

## 사용처

.NET 상태 변화는 `event`, 값과 완료를 전달하는 스트림은 `IObservable<T>`, 화면에 이미 있는 상태 바인딩은 프레임워크 바인딩 기능을 고려한다. 수신자가 하나이고 호출 순서를 제어해야 하면 직접 호출이 간단하다.

## 장단점

동일한 변화를 여러 곳에 전달할 수 있다. 오래 사는 발행자가 이벤트 핸들러에 연결된 객체를 계속 참조할 수 있다. 콜백 실패가 이후 알림 전달에 미치는 영향과 콜백 스레드 계약을 정해야 한다.

## 구현 방식

발행자는 상태 변경 후 콜백을 실행한다. 이벤트에서는 `+=`와 `-=`의 짝을 맞춘다. `IObservable<T>.Subscribe`가 돌려준 `IDisposable`을 구독 수명에 맞춰 해제한다. 동기 이벤트의 핸들러는 발행한 스레드에서 실행된다. UI 스레드에서 소비해야 하는 알림은 디스패처나 스케줄러의 실행 규약을 명시한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — event로 상태 변화 전달

작업 진행률이 실제로 달라질 때만 변경을 알린다. 이 발행자는 값 변경과 콜백을 같은 스레드에서 수행한다.

```csharp
var progress = new ProgressState();
var changes = new List<int>();
progress.Changed += (_, value) => changes.Add(value);

progress.Update(30);
progress.Update(30);
progress.Update(100);

if (!changes.SequenceEqual([30, 100]))
    throw new InvalidOperationException("Expected only two transitions");

sealed class ProgressState
{
    public event EventHandler<int>? Changed;
    public int Percent { get; private set; }

    public void Update(int value)
    {
        if (Percent == value)
            return;
        Percent = value;
        Changed?.Invoke(this, value);
    }
}
```

30을 두 번 설정해도 `30`, `100` 두 알림만 받는다. 발행자의 상태 값은 알림을 보내기 전에 변경된다.

### 사례 2 — IObservable 값 스트림에 두 구독자 연결

수신기 두 개가 한 측정 스트림을 구독한다. 순차 실행을 전제로 하고, `Dispose` 이후에는 추가 값을 받지 않는다. 이 예시는 완료나 오류를 발행하지 않는 측정 스트림이다.

```csharp
var samples = new Samples();
var screen = new Reader();
var log = new Reader();
using var screenSubscription = samples.Subscribe(screen);
using (samples.Subscribe(log))
{
    samples.Publish(18);
}

samples.Publish(21);
if (!screen.Received.SequenceEqual([18, 21]) || !log.Received.SequenceEqual([18]))
    throw new InvalidOperationException("Subscription lifetime mismatch");

sealed class Samples : IObservable<int>
{
    private event Action<int>? available;

    public IDisposable Subscribe(IObserver<int> observer)
    {
        // A separate callback gives each subscription its own identity.
        Action<int> deliver = value => observer.OnNext(value);
        available += deliver;
        return new Subscription(() => available -= deliver);
    }

    public void Publish(int value) => available?.Invoke(value);

    private sealed class Subscription(Action unsubscribe) : IDisposable
    {
        private Action? release = unsubscribe;

        public void Dispose() => Interlocked.Exchange(ref release, null)?.Invoke();
    }
}

sealed class Reader : IObserver<int>
{
    public List<int> Received { get; } = [];
    public void OnNext(int value) => Received.Add(value);
    public void OnCompleted() { }
    public void OnError(Exception error) => throw new InvalidOperationException("Stream failed", error);
}
```

화면 구독자는 18, 21을 받고 로그 구독자는 해제 전의 18만 받는다. 구현은 구독과 발행을 직렬로 호출하는 환경을 가정한다.

### 사례 3 — 장수 발행자의 해제와 콜백 스레드 확인

장수 발행자를 짧게 구독하는 화면 모델 대신 콘솔에 검증 대역을 둔다. 새 작업자 스레드에서 발행한 뒤 구독을 해제하고 다시 발행한다.

```csharp
var clock = new Clock();
var callbackThreads = new List<int>();
int workerThread = 0;

using (new ViewSubscription(clock, () =>
    callbackThreads.Add(Environment.CurrentManagedThreadId)))
{
    var worker = new Thread(() =>
    {
        workerThread = Environment.CurrentManagedThreadId;
        clock.Tick();
    });
    worker.Start();
    worker.Join();
}

clock.Tick();
if (!callbackThreads.SequenceEqual([workerThread]))
    throw new InvalidOperationException("Wrong thread or subscription leak");

sealed class Clock
{
    public event EventHandler? Ticked;
    public void Tick() => Ticked?.Invoke(this, EventArgs.Empty);
}

sealed class ViewSubscription : IDisposable
{
    private readonly Clock clock;
    private readonly EventHandler handler;

    public ViewSubscription(Clock clock, Action update)
    {
        this.clock = clock;
        handler = (_, _) => update();
        clock.Ticked += handler;
    }

    public void Dispose() => clock.Ticked -= handler;
}
```

첫 콜백은 작업자 스레드에서 실행된다. 구독 해제 후 발행에서 두 번째 호출이 생기지 않는지 확인한다. 실행 중인 콜백과 해제가 동시에 일어나는 상황에서는 이미 시작된 콜백의 종료 규약을 별도로 마련한다.

## 관련 문서

[Decorator](decorator.md)는 호출을 감싸 시간이나 결과를 기록할 때 쓴다. [Microsoft Learn의 IObservable 구독과 해제](https://learn.microsoft.com/dotnet/api/system.iobservable-1.subscribe)
