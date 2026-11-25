# Factory — 생성 경계

## 목적

생성에 필요한 구현 선택과 불변 조건 검증을 한 곳에 모은다. 호출자는 입력과 반환 계약만 알면 된다.

## 사용처

입력에 따라 구현이 달라지거나 생성 이후 무효한 상태를 허용할 수 없을 때 쓴다. 호출자 모두가 같은 생성자에 값을 그대로 넘기면 직접 생성으로 충분하다.

## 장단점

반환 타입과 생성 실패를 한 곳에서 확인할 수 있다. 팩터리가 여러 구현을 가지면 등록 누락 처리와 수명 규칙이 늘어난다. 이미 DI가 인스턴스를 소유하는 경우에는 중복 해제를 피한다.

## 구현 방식

이름 있는 정적 메서드 또는 팩터리 객체가 입력을 검증하고 구현을 선택한다. 성공한 객체의 소유자를 계약에 명시한다. 초기화 도중 실패하면 팩터리가 이미 확보한 자원을 해제한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 입력 종류에 따른 작성기 선택

내보내기 형식에 따라 동일한 계약의 작성기를 반환한다. 두 작성기는 메모리에서 문자열만 만든다.

```csharp
if (ExportWriter.Create(ExportFormat.Csv).Write("A", "B") != "A,B")
    throw new InvalidOperationException("CSV writer selection failed");
if (ExportWriter.Create(ExportFormat.Tsv).Write("A", "B") != "A\tB")
    throw new InvalidOperationException("TSV writer selection failed");

enum ExportFormat { Csv, Tsv }

interface IExportWriter
{
    string Write(string first, string second);
}

static class ExportWriter
{
    public static IExportWriter Create(ExportFormat format) => format switch
    {
        ExportFormat.Csv => new DelimitedWriter(","),
        ExportFormat.Tsv => new DelimitedWriter("\t"),
        _ => throw new ArgumentOutOfRangeException(nameof(format))
    };
}

sealed class DelimitedWriter(string delimiter) : IExportWriter
{
    public string Write(string first, string second) => string.Join(delimiter, first, second);
}
```

실행하면 두 형식의 구분 문자가 서로 다르다. 확인용 입력은 구분 문자와 줄바꿈이 없는 값으로 제한한다.

### 사례 2 — 생성 시 범위 검증

가격 할인율의 입력 범위를 판단하고, 성공한 할인 객체에서 값이 변경되지 않게 한다.

```csharp
var discount = Discount.Create(0.2m);
if (discount.Apply(50m) != 40m)
    throw new InvalidOperationException("Wrong discounted price");

try
{
    Discount.Create(1.2m);
    throw new InvalidOperationException("Expected out-of-range rate");
}
catch (ArgumentOutOfRangeException error) when (error.ParamName == "rate")
{
}

sealed class Discount
{
    private readonly decimal rate;

    private Discount(decimal rate) => this.rate = rate;

    public static Discount Create(decimal rate)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(rate, 0m);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(rate, 1m);
        return new Discount(rate);
    }

    public decimal Apply(decimal price) => price * (1m - rate);
}
```

실행하면 20% 할인 가격은 40이다. 범위를 벗어난 할인율은 생성 단계에서 거절된다.

### 사례 3 — 미등록 구현과 초기화 중 자원 해제

가져오기 형식으로 스트림 초기화 함수를 고른다. 메모리 스트림으로 등록 누락, 초기화 실패, 성공 후 소유권 이전을 확인한다.

```csharp
var opens = 0;
MemoryStream? latest = null;
var factory = new ImportFactory(() =>
{
    opens++;
    latest = new MemoryStream();
    return latest;
});

try
{
    factory.Open("missing");
    throw new InvalidOperationException("Expected a missing format");
}
catch (NotSupportedException) when (opens == 0)
{
}

try
{
    factory.Open("broken");
    throw new InvalidOperationException("Expected initialization failure");
}
catch (IOException) when (latest is { CanRead: false })
{
}

using (var active = factory.Open("text"))
{
    if (!active.CanRead)
        throw new InvalidOperationException("Disposed before ownership transfer");
}

if (latest is null || latest.CanRead || opens != 2)
    throw new InvalidOperationException("Resource lifetime mismatch");

sealed class ImportFactory(Func<Stream> open)
{
    private readonly Dictionary<string, Action<Stream>> formats = new(StringComparer.Ordinal)
    {
        ["text"] = stream => stream.Position = 0,
        ["broken"] = _ => throw new IOException("Invalid format header")
    };

    public Stream Open(string format)
    {
        if (!formats.TryGetValue(format, out var initialize))
            throw new NotSupportedException(format);

        var stream = open();
        try
        {
            initialize(stream);
            return stream;
        }
        catch
        {
            stream.Dispose();
            throw;
        }
    }
}
```

실행하면 미등록 형식은 스트림을 열기 전에 실패한다. 초기화 중 예외가 나면 팩터리가 정리하고 성공한 스트림은 호출부의 `using`이 해제한다. 이 대역에서 `Dispose`는 성공한다.

## 관련 문서

[Builder](builder.md)는 생성 입력을 여러 단계에서 조립한다. [Dependency Injection](dependency-injection.md) 컨테이너가 제공한 객체는 해당 등록의 수명과 해제 규칙을 따른다.
