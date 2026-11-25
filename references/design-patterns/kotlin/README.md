# Kotlin 디자인 패턴

먼저 Gradle에 지정된 Kotlin 버전과 JVM, Android 등 대상 플랫폼을 확인한다. Android나 서버 프로젝트에서 이미 쓰는 코루틴 스코프, 의존성 주입(DI), 상태 관리 방식에 맞춘다.

| 패턴 | 선택 기준 |
| --- | --- |
| [Strategy](strategy.md) | 같은 작업에서 순위나 가격 등 정책만 바꾼다. |
| [State](state.md) | 상태별 데이터가 다르거나 허용할 전이를 명시해야 한다. |
| [Decorator](decorator.md) | 기존 인터페이스를 유지하면서 계측이나 검사를 추가한다. |
| [Observer](observer.md) | 화면이 최신 상태를 구독하고 화면 수명에 따라 수집을 멈춘다. |
| [Adapter](adapter.md) | 외부 DTO의 null, 오류, 데이터 표현을 내부 계약으로 바꾼다. |
| [Repository](repository.md) | 도메인 조회와 저장 계약을 유지하면서 캐시와 원격 데이터 소스를 조합한다. |
| [구조화된 동시성](structured-concurrency.md) | 함께 처리하는 작업의 수명과 취소를 한 요청에 묶는다. |
| [객체 생성](object-creation.md) | 설정의 기본값과 불변식을 정하거나 여러 단계의 구성을 표현한다. |

## 예시 실행

각 Kotlin 코드 블록을 독립된 파일 `Main.kt`로 저장한다. 예시는 JDK 17과 Kotlin/JVM 2.1.21을 기준으로 한다. 코루틴 예시는 클래스 경로에 `org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.0`을 추가한다. Java 호출과 Android Compose 예시의 파일명과 실행 절차는 해당 사례에 적었다.

```sh
kotlinc Main.kt -include-runtime -d example.jar
java -jar example.jar
```

코루틴 예시는 아래 명령으로 실행한다. Windows에서는 두 번째 명령의 클래스 경로 구분자에 세미콜론을 쓴다.

```sh
kotlinc Main.kt -classpath kotlinx-coroutines-core-jvm-1.8.0.jar -include-runtime -d example.jar
java -classpath "example.jar:kotlinx-coroutines-core-jvm-1.8.0.jar" MainKt
```
