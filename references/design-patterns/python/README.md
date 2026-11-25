# Python 디자인 패턴

`pyproject.toml`에서 지원하는 Python 버전, 타입 검사 도구, 의존성을 확인하고 기존 호출 경로가 동기인지 비동기인지 살핀다. 프로젝트에서 쓰는 덕 타이핑과 오류 처리 관례를 따른다. 함수, 호출 가능 객체, 모듈만으로도 많은 경계를 표현할 수 있다.

외부 구현을 바꿔 끼워야 한다면 소비자가 요구하는 메서드만 `Protocol`에 정의한다. 타입 검사기는 실제 구현과 테스트 대역이 같은 메서드 계약을 따르는지 확인한다. 외부에서 들어온 값은 실행 중에 별도로 검증한다. [Python `typing.Protocol` 문서](https://docs.python.org/3.12/library/typing.html#typing.Protocol)

| 패턴 | 선택 기준 |
| --- | --- |
| [Strategy](strategy.md) | 정렬, 가격, 검증 같은 정책을 호출하는 흐름은 유지하면서 정책만 교체한다. |
| [Adapter](adapter.md) | 외부 SDK의 필드, 메서드 이름, 값의 의미와 오류를 내부 계약에 맞춘다. |
| [Repository](repository.md) | 서비스가 도메인 모델로 데이터를 다루고 저장 방식과 조회 실패를 한 경계에서 관리한다. |
| [Decorator](decorator.md) | 원래 호출의 반환, 예외, 실행 시점을 유지하며 여러 함수에 계측이나 캐시를 더한다. |
| [Context Manager](context-manager.md) | 파일, 세션, 잠금처럼 수명이 있는 자원을 블록 범위에서 정리한다. |
| [Factory](factory.md) | 외부 옵션에 따른 구현 선택과 객체 조립을 생성 경계에 모은다. |
| [Pipeline](pipeline.md) | 한 단계의 출력이 다음 단계의 입력이 되고 실행 순서와 중도 실패의 의미가 정해져 있다. |
| [Observer](observer.md) | 도메인 변경이나 프레임워크 이벤트를 여러 독립적인 수신자에게 전달한다. |

각 사례는 독립 실행용이다. 해당 코드 블록을 별도 `.py` 파일에 저장한 뒤 `python 파일명.py`로 실행한다. 사례에서 안내하는 출력이나 `assert`로 결과를 확인한다. Django가 필요한 사례 두 곳에는 설치 방법을 적었다.

[전체 디자인 패턴 목차](../README.md)
