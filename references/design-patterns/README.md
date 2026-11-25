# 언어별 디자인 패턴

새 설계가 필요한 기능이나 리팩터링에서는 프로젝트의 기존 경계와 프레임워크 관례를 먼저 살핀다.
구현 언어의 목차에서 해결하려는 문제에 맞는 패턴을 찾고 해당 문서를 연다. 각 문서는 패턴의
목적과 사용처, 장단점, 구현 방식, 검증 방법을 포함한 예시 세 가지를 설명한다.

| 언어 | 자주 쓰는 설계 방식 |
| --- | --- |
| [Java](./java/README.md) | 함수형 Strategy, Builder, Spring DI |
| [Kotlin](./kotlin/README.md) | 함수형 Strategy, sealed 타입으로 상태 표현, 코루틴 수명 |
| [Go](./go/README.md) | 작은 인터페이스, 함수형 옵션, HTTP 미들웨어 |
| [Dart](./dart/README.md) | Flutter의 위젯 합성, 상태 관리, Repository |
| [JavaScript](./javascript/README.md) | 모듈과 클로저, 함수 합성, 이벤트 구독 |
| [TypeScript](./typescript/README.md) | 판별 유니온, 외부 입력 검증, 구조적 타입 기반 Adapter |
| [C#](./csharp/README.md) | .NET DI, Decorator, ASP.NET Core 미들웨어 |
| [C++](./cpp/README.md) | RAII, 템플릿 정책, 런타임 다형성, Pimpl |
| [Python](./python/README.md) | 호출 가능 객체, Protocol, 컨텍스트 매니저 |

후보가 여럿이면 가장 적은 코드로 필요한 변경 지점을 드러내는 방식을 고른다. 패턴을
적용할 때는 호출자가 관찰하는 동작과 책임이 어디에 남는지 확인한다. 외부 호출은 실패와
취소, 이벤트는 구독 해제, 상태 전이는 허용되지 않은 입력부터 확인한다.
