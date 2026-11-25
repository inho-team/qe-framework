# State

## 목적

현재 상태에 필요한 데이터와 그 상태에서 허용할 전이를 코드로 표현한다. 예를 들어 결제 승인을 담는 상태에는 승인 번호가 있고 거절 상태에는 거절 사유가 있다.

## 사용처

상태에 따라 화면에 그릴 데이터나 처리할 이벤트가 다르면 `sealed interface`를 고려한다. 데이터 없이 활성 여부만 표현하면 `Boolean` 하나로 충분하다.

## 장단점

서로 다른 상태의 필드를 별도 타입에 두면 표현 가능한 조합이 줄고, 완전한 `when` 식은 하위 타입을 추가했을 때 수정할 곳을 알려 준다. 상태 타입만으로는 전이 순서를 제한할 수 없으므로 전이 함수에서 규칙을 적용한다. 상태를 저장한다면 이전 버전의 판별 값과 필드를 읽을 수 있도록 저장 형식의 호환성을 확인한다.

## 구현 방식

상태를 닫힌 타입 계층으로 선언하고 상태마다 필요한 값을 생성자에서 받는다. 읽는 쪽은 `when` 식으로 분기한다. 이벤트 순서가 중요한 경우 상태와 이벤트를 한곳에서 받아 다음 상태를 결정한다.

## 예시

### 사례 1 — 로딩과 표시할 데이터 표현

프로필을 읽는 화면은 읽는 중에는 진행 메시지를, 읽기에 성공하면 표시 이름을 보여 준다. 실패 상태에는 오류 메시지를 보관한다.

```kotlin
sealed interface ProfileState {
    object Loading : ProfileState
    data class Ready(val displayName: String) : ProfileState
    data class Failed(val message: String) : ProfileState
}

fun label(state: ProfileState): String = when (state) {
    ProfileState.Loading -> "불러오는 중"
    is ProfileState.Ready -> state.displayName
    is ProfileState.Failed -> state.message
}

fun main() {
    check(label(ProfileState.Loading) == "불러오는 중")
    check(label(ProfileState.Ready("민지")) == "민지")
    check(label(ProfileState.Failed("읽기 실패")) == "읽기 실패")
}
```

[예시 실행](README.md#예시-실행) 명령으로 세 분기를 확인한다. Kotlin/JVM 1.5 이상을 사용한다.

### 사례 2 — 결제 승인과 거절의 데이터 분리

승인 영수증에는 승인 번호와 결제액이, 거절 안내에는 거절 코드와 재시도 가능 여부가 필요하다.

```kotlin
sealed interface Payment {
    data class Approved(val authorizationId: String, val amount: Int) : Payment
    data class Declined(val reasonCode: String, val retryable: Boolean) : Payment
}

fun receipt(payment: Payment): String = when (payment) {
    is Payment.Approved -> "승인 ${payment.authorizationId} · ${payment.amount}원"
    is Payment.Declined -> {
        val action = if (payment.retryable) "재시도" else "결제 수단 변경"
        "거절 ${payment.reasonCode} · $action"
    }
}

fun main() {
    check(receipt(Payment.Approved("P17", 3500)) == "승인 P17 · 3500원")
    check(receipt(Payment.Declined("LIMIT", false)) == "거절 LIMIT · 결제 수단 변경")
    check(receipt(Payment.Declined("TEMP", true)) == "거절 TEMP · 재시도")
}
```

[예시 실행](README.md#예시-실행) 명령으로 승인과 두 가지 거절 안내를 확인한다. Kotlin/JVM 1.5 이상을 사용한다.

### 사례 3 — 늦게 도착한 이전 검색 응답 처리

두 검색을 차례로 시작한 뒤 최신 응답이 먼저 도착할 수 있다. 화면에서 발급한 요청 ID로 현재 요청의 완료만 반영한다.

```kotlin
sealed interface Search {
    object Idle : Search
    data class Loading(val id: Int) : Search
    data class Ready(val results: List<String>) : Search
}

sealed interface Event {
    data class Started(val id: Int) : Event
    data class Completed(val id: Int, val results: List<String>) : Event
}

fun next(state: Search, event: Event): Search = when (event) {
    is Event.Started -> Search.Loading(event.id)
    is Event.Completed ->
        if (state is Search.Loading && state.id == event.id) {
            Search.Ready(event.results)
        } else {
            state
        }
}

fun main() {
    val first = next(Search.Idle, Event.Started(1))
    val second = next(first, Event.Started(2))
    check(next(second, Event.Completed(1, listOf("이전"))) == second)

    val ready = next(second, Event.Completed(2, listOf("최신")))
    check(ready == Search.Ready(listOf("최신")))
    check(next(ready, Event.Completed(1, listOf("이전"))) == ready)
}
```

[예시 실행](README.md#예시-실행) 명령을 사용한다. 이전 응답이 최신 응답의 전후 어느 시점에 도착해도 결과가 덮어써지지 않는지 확인한다. Kotlin/JVM 1.5 이상을 사용한다.

## 관련 문서

- [Observer](observer.md)는 결정한 상태를 화면에 전달하는 방법을 다룬다.
- [Kotlin sealed 클래스와 인터페이스](https://kotlinlang.org/docs/sealed-classes.html)
