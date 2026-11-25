# C# 디자인 패턴

`.csproj`에서 대상 프레임워크(`TargetFramework`), C# 버전(`LangVersion`), nullable 참조 형식(`Nullable`) 설정을 확인한다. 패턴을 적용하기 전에 프로젝트의 기존 DI 등록 지점, 서비스 인터페이스, 취소 토큰 전달 방식을 확인한다. ASP.NET Core나 Unity에서는 프레임워크가 객체를 생성하고 해제하는 시점에 맞춘다.

| 패턴 | 선택 기준 |
| --- | --- |
| [Dependency Injection](dependency-injection.md) | 서비스 구현을 구성 지점에서 교체하거나 요청 스코프에서 공유한다. |
| [Strategy](strategy.md) | 계산이나 검증 정책을 같은 계약 아래 선택한다. |
| [Decorator](decorator.md) | 서비스 계약을 유지하면서 호출에 계측이나 캐시를 추가한다. |
| [Middleware](middleware.md) | 여러 HTTP 경로에서 요청과 응답에 적용하는 동작을 순서대로 조립한다. |
| [Adapter](adapter.md) | 외부 SDK의 모델과 오류, 호출 방식을 내부 계약에 맞춘다. |
| [Repository](repository.md) | 도메인에 필요한 질의를 저장소 경계에서 실행하고 결과를 반환한다. |
| [Observer](observer.md) | 데이터 또는 화면 상태의 변화를 여러 구독자에게 전달한다. |
| [Factory](factory.md) | 생성 방식과 구현 선택을 한 곳에서 관리하고 생성 시 불변 조건을 검사한다. |
| [Builder](builder.md) | 서로 다른 단계에서 얻은 값을 모아 완성된 객체를 만든다. |

## 실행 환경

사례별로 빈 프로젝트를 만든다. 콘솔 예시는 `dotnet new console --framework net8.0`, ASP.NET Core 예시는 `dotnet new web --framework net8.0`을 사용한다. 지시에 따라 참조를 추가하고 템플릿의 `Program.cs` 전체를 해당 사례로 바꾼다. 사례별로 `dotnet build`와 `dotnet run --no-build`를 실행한다. 코드에 포함된 검증 조건이 어긋나면 예외와 함께 종료된다.

웹 템플릿은 `Microsoft.NET.Sdk.Web`을 통해 `Microsoft.AspNetCore.App` 공유 프레임워크를 참조한다. 공유 프레임워크가 필요한 콘솔 예시에는 `.csproj`의 `ItemGroup`에 `<FrameworkReference Include="Microsoft.AspNetCore.App" />`를 추가한다. EF Core 예시는 각 사례에 적힌 NuGet 패키지가 필요하다.

C# 12의 기본 생성자와 컬렉션 식을 사용하는 예시가 있다. 기존 프로젝트에서 예시를 옮길 때는 대상 프레임워크와 컴파일러가 지원하는 구문을 기준으로 옮긴다.
