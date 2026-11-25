# Go 디자인 패턴

`go.mod`에 지정된 Go 버전과 주변 패키지의 생성자, 오류 처리, 취소 방식을 확인한다. 연산 하나를 바꿀 때는 함수 타입으로 표현할 수 있다. 구현을 교체하는 경계에서는 소비자 패키지에 필요한 메서드만 인터페이스로 둔다.

| 패턴 | 선택 기준 |
| --- | --- |
| [Adapter](adapter.md) | 외부 응답과 오류 또는 기존 메서드를 소비자의 계약에 맞춰야 한다. |
| [의존성 주입](dependency-injection.md) | 서비스 밖에서 저장소를 선택하거나 공유 자원의 수명을 관리해야 한다. |
| [Strategy](strategy.md) | 같은 처리 흐름에서 정렬 기준이나 검증 규칙만 교체한다. |
| [Functional Options](functional-options.md) | 공개 생성자의 선택 설정이 많고 호출마다 일부만 지정한다. |
| [Decorator](decorator.md) | 기존 인터페이스로 호출하면서 계측이나 캐시를 추가한다. |
| [Middleware](middleware.md) | 여러 HTTP 핸들러에 공통 처리를 적용하며 실행 순서와 조기 응답을 제어한다. |
| [Fan-out / Fan-in](fan-out-fan-in.md) | 독립 작업을 여러 작업자가 처리하고 한 곳에서 결과와 오류를 모은다. |
| [자원 정리](resource-cleanup.md) | 파일, 잠금, 응답 본문을 함수나 항목 단위로 정리한다. |
| [지연 초기화](lazy-initialization.md) | 공유 값을 처음 사용하는 시점에 준비하고 동시 접근이나 재시도를 제어한다. |
