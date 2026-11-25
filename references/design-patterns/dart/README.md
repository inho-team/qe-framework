# Dart 디자인 패턴

`pubspec.yaml`의 `environment.sdk`와 의존성을 먼저 확인한다. 예시는 Dart 3.0 이상을 기준으로 하며, Flutter 위젯 예시는 Flutter SDK와 `flutter_test`가 필요한 곳에 따로 표시한다. Flutter 프로젝트에서는 이미 채택한 상태 관리 방식과 위젯의 수명 규칙을 따르고, 플랫폼 API를 쓸 때는 대상 플랫폼의 지원 범위와 오류 계약을 확인한다.

| 패턴 | 선택 기준 |
| --- | --- |
| [Composition](composition.md) | 작은 위젯을 여러 화면에서 재사용하고 입력 속성, 콜백, 상태 소유권을 조합한다. |
| [State](state.md) | 로딩, 성공, 실패가 서로 다른 값을 가지거나 요청 순서에 따라 유효한 상태 전이가 달라진다. |
| [Observer](observer.md) | 값의 변경이나 연속 이벤트를 UI와 여러 소비자에게 알린다. |
| [Repository](repository.md) | 데이터 접근 계약을 유지하면서 원격, 로컬, 캐시 정책을 교체한다. |
| [Adapter](adapter.md) | 외부 JSON, 플랫폼 API의 타입과 오류를 앱의 계약으로 변환한다. |
| [Strategy](strategy.md) | 호출 순서는 같고 가격 계산, 검증 등의 정책만 달라진다. |
| [Factory](factory.md) | 외부 입력을 검증해 객체를 만들거나 설정에 따라 구현을 선택한다. |
| [ViewModel](viewmodel.md) | 화면에 보여 줄 상태와 명령을 한곳에서 관리하고 작업 수명을 조율한다. |

변경 범위를 기준으로 패턴을 고른다. 예를 들어 프로필 조회에서 API 응답 변환이 필요하면 Adapter를 두고, 원격 조회와 캐시를 한 정책으로 운영해야 하면 Repository를 둔다. 화면에서 해당 조회의 시작, 재시도, 종료를 조율할 때는 ViewModel의 책임으로 둔다.
