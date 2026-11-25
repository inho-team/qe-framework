# Builder — 단계별 객체 조립

## 목적

여러 출처에서 얻는 생성 입력을 단계별로 모으고 마지막 단계에서 완성된 객체를 만든다. 검증과 컬렉션 복사 같은 조립 책임을 생성 경계에 둔다.

## 사용처

선택 인자가 많거나 여러 단계에서 필수 정보를 얻을 때 쓴다. 생성자 인자가 적거나 옵션이 독립적이면 이름 있는 인자나 객체 초기화 식으로 충분하다.

## 장단점

호출부에서 조립 순서와 기본값을 읽기 쉽다. 가변 Builder의 재사용과 동시 호출에는 상태 관리 비용이 생긴다. 불변 조립은 각 호출에 새 중간 값이 할당될 수 있고, 단계별 타입을 만들면 타입 수가 늘어난다.

## 구현 방식

조립 중간 값과 결과 타입을 분리한다. `Build`에서 여러 필드 사이의 제약을 검사하거나, 필수 단계를 타입으로 드러낸다. C#의 `init`과 레코드의 `with`는 참조된 컬렉션까지 불변으로 만들지 않으므로, 컬렉션을 받거나 반환하는 경계에서 소유권을 정한다.

## 예시

별도 안내가 없으면 각 사례를 독립된 .NET 8 / C# 12 프로젝트의 `Program.cs`에 붙여 넣는다. [실행 환경](README.md#실행-환경)에 따라 빌드하고 실행한다.

### 사례 1 — 여러 선택 인자로 업로드 요청 조립

대상 파일은 필수이며 압축과 검증 옵션은 각각 기본값이 있다. 호출자는 변경할 옵션만 설정한다.

```csharp
var request = new UploadBuilder("report.csv").WithCompression().WithoutChecksum().Build();
if (request != new UploadRequest("report.csv", true, false))
    throw new InvalidOperationException("Incorrect upload options");

sealed record UploadRequest(string Path, bool Compress, bool Checksum);

sealed class UploadBuilder(string path)
{
    private bool compress;
    private bool checksum = true;

    public UploadBuilder WithCompression()
    {
        compress = true;
        return this;
    }

    public UploadBuilder WithoutChecksum()
    {
        checksum = false;
        return this;
    }

    public UploadRequest Build() => new(path, compress, checksum);
}
```

실행하면 `report.csv`에 압축을 적용하고 체크섬은 생략하는 값이 완성된다. `WithCompression()`만 호출하면 체크섬 기본값 `true`가 유지된다.

### 사례 2 — 필수 단계와 불변 중간 값 사용

알림 요청의 수신자를 먼저 정한다. 수신자가 정해진 단계에서 제목을 바꾼 두 값을 만들고 각각 독립적으로 완성한다.

```csharp
var routed = NoticeBuilder.For("editor@example.test");
var urgent = routed.WithSubject("Urgent");
if (routed.Build().Subject != "Summary" || urgent.Build().Subject != "Urgent")
    throw new InvalidOperationException("Drafts shared mutable state");

sealed record Notice(string Recipient, string Subject);

static class NoticeBuilder
{
    public static AddressedNotice For(string recipient) => new(recipient);
}

sealed class AddressedNotice
{
    private readonly string recipient;
    private readonly string subject;

    internal AddressedNotice(string recipient, string subject = "Summary")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(recipient);
        this.recipient = recipient;
        this.subject = subject;
    }

    public AddressedNotice WithSubject(string value) => new(recipient, value);
    public Notice Build() => new(recipient, subject);
}
```

실행하면 같은 수신자로 제목이 다른 알림 두 개를 얻는다. `For`를 호출하기 전에는 `Build`에 접근할 객체가 없다.

### 사례 3 — 필수 값 누락과 가변 컬렉션 분리

보고서 조립 중 제목 누락을 거절한다. 열 목록은 입력과 완성 결과의 경계에서 복사해 서로의 변경을 격리한다.

```csharp
var columns = new List<string> { "amount" };
var builder = new ReportBuilder().WithColumns(columns);
columns.Add("private");
try
{
    builder.Build();
    throw new InvalidOperationException("Expected required title");
}
catch (InvalidOperationException error) when (error.Message == "Title is required")
{
}

var report = builder.WithTitle("Sales").Build();
builder.WithColumns(["count"]);
if (report.Title != "Sales" || !report.Columns.SequenceEqual(["amount"]))
    throw new InvalidOperationException("Report shared mutable state");

sealed class ReportBuilder
{
    private string? title;
    private string[] columns = [];

    public ReportBuilder WithTitle(string value)
    {
        title = value;
        return this;
    }

    public ReportBuilder WithColumns(IEnumerable<string> values)
    {
        columns = values.ToArray();
        return this;
    }

    public Report Build()
    {
        if (string.IsNullOrWhiteSpace(title))
            throw new InvalidOperationException("Title is required");
        return new Report(title, Array.AsReadOnly(columns.ToArray()));
    }
}

sealed record Report(string Title, IReadOnlyList<string> Columns);
```

제목을 넣기 전에는 생성에 실패한다. 생성한 `report`의 열은 원본 목록을 수정해도, Builder에서 열을 교체해도 `amount` 하나로 유지된다.

## 관련 문서

[Factory](factory.md)는 완성에 필요한 입력이 모인 경계에서 구현 선택과 불변 조건 검증을 맡는다.
