# Java 디자인 패턴

`pom.xml`이나 Gradle의 Java toolchain 설정에서 대상 JDK를 확인한다. Spring 프로젝트에서는 기존 구성 클래스와 빈 스코프를 확인하고, 트랜잭션이 어느 빈의 호출 경계에서 시작되고 끝나는지 파악한다.

| 패턴 | 선택 기준 |
| --- | --- |
| [Strategy](strategy.md) | 요금이나 배정처럼 같은 계약 아래 알고리즘을 교체할 때 사용한다. |
| [Builder](builder.md) | 필수값과 선택값이 여럿이고 완성된 객체에 값 사이의 제약이 있을 때 사용한다. |
| [Factory](factory.md) | 입력이나 설정에 따라 구현을 고르거나 자원 생성 절차를 한곳에서 관리할 때 사용한다. |
| [Adapter](adapter.md) | 공급자 SDK나 기존 API의 타입과 오류를 도메인 계약에 맞출 때 사용한다. |
| [Decorator](decorator.md) | 기존 인터페이스를 유지하면서 호출에 계측이나 캐시를 덧붙일 때 사용한다. |
| [State](state.md) | 허용할 상태 전이와 상태별로 보유할 데이터를 코드에 명시할 때 사용한다. |
| [Dependency Injection](dependency-injection.md) | 서비스가 필요로 하는 구현을 조립 지점에서 전달하고 자원 수명을 관리할 때 사용한다. |

독립 실행 예시는 JDK 17 이상에서 각 코드 블록을 지정한 파일명으로 저장해 실행한다. Spring 예제의 의존성과 프로젝트 구성은 해당 사례에 적었다.
