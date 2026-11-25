# Observer

## 목적

상태를 가진 객체가 바뀐 값을 구독자에게 전달한다. 화면은 현재 상태를 렌더링하고 상호작용을 상태 소유자에게 알린다.

## 사용처

비동기 조회 결과나 편집 상태를 여러 소비자가 관찰하면 `StateFlow`를 고려한다. 상태를 읽는 곳이 컴포저블 하나뿐이면 그 안의 Compose 상태로 충분할 수 있다.

## 장단점

`StateFlow`는 새 구독자에게 최신 값을 제공한다. 값이 이전 값과 같으면 갱신을 내보내지 않으며, 느린 구독자는 빠르게 바뀐 중간 상태를 건너뛸 수 있다. 모든 알림을 전달해야 한다면 별도 계약이 필요하고, 구독 작업은 화면 수명에 맞춰 취소해야 한다.

## 구현 방식

상태 소유자에게만 쓰기 권한을 두고 읽기용 `StateFlow`를 공개한다. Android Compose에서 외부 Flow를 수집하는 화면은 `androidx.lifecycle:lifecycle-runtime-compose`의 `collectAsStateWithLifecycle`로 수집을 수명에 맞출 수 있다. 화면 안에서만 쓰는 상태는 읽고 쓰는 컴포저블의 공통 상위에 두고, 하위에는 값과 이벤트 콜백을 전달한다. 일회성 효과는 구독자가 없는 동안에도 보존할지 먼저 정한다.

## 예시

### 사례 1 — StateFlow로 장바구니 화면 갱신

장바구니 모델은 상품 수를 갱신하고, 화면은 읽기 전용 상태를 수집한다.

```kotlin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

data class CartState(val itemCount: Int)

class Cart {
    private val mutableState = MutableStateFlow(CartState(0))
    val state = mutableState.asStateFlow()

    fun addItem() = mutableState.update { CartState(it.itemCount + 1) }
}

fun main() = runBlocking {
    val cart = Cart()
    val initialRendered = CompletableDeferred<Unit>()
    val seen = mutableListOf<CartState>()
    val screen = launch {
        cart.state.take(2).collect {
            seen += it
            if (seen.size == 1) initialRendered.complete(Unit)
        }
    }
    initialRendered.await()
    cart.addItem()
    screen.join()
    check(seen == listOf(CartState(0), CartState(1)))
    check(cart.state.take(1).toList() == listOf(CartState(1)))
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 화면은 상품 수 0과 1을 차례로 렌더링하며, 새 구독자는 최신 값인 1을 바로 받는다.

### 사례 2 — Compose에서 상태와 이벤트 전달

수량 화면의 상위 컴포저블이 상태를 가진다. 하위 컴포저블은 현재 수량을 표시하고 버튼을 누를 때 콜백으로 이벤트를 알린다.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

@Composable
fun QuantityRoute() {
    var quantity by rememberSaveable { mutableIntStateOf(0) }
    QuantityScreen(quantity = quantity, onAdd = { quantity += 1 })
}

@Composable
fun QuantityScreen(quantity: Int, onAdd: () -> Unit) {
    Column {
        Text("수량 $quantity")
        Button(onClick = onAdd) { Text("추가") }
    }
}
```

Compose 컴파일러가 설정된 Android 앱에서 실행한다. 예시는 Kotlin과 Compose 컴파일러 플러그인 2.1.21, Compose Runtime·Runtime Saveable·Foundation·Foundation Layout 1.8.2, Material 3 1.3.2를 기준으로 한다. 앱 모듈의 `QuantityScreen.kt`에 저장하고 기존 Activity의 `setContent { QuantityRoute() }`에서 띄운다. 추가 버튼을 두 번 누르면 수량 2가 표시된다. 화면을 회전하면 Activity가 재생성되어도 `rememberSaveable`이 수량을 복원한다. 상태 변경 코드는 `QuantityRoute`에 있고 이벤트는 하위에서 상위로 전달된다.

### 사례 3 — 재구독할 때 최신 상태와 일회성 효과 확인

저장 결과는 화면이 돌아왔을 때도 표시한다. 저장 토스트는 화면이 수집하는 동안만 표시하는 정책으로 정한다.

```kotlin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val status = MutableStateFlow("idle")
    val effects = MutableSharedFlow<String>(replay = 0)
    val firstEffect = CompletableDeferred<Unit>()
    val secondEffect = CompletableDeferred<Unit>()
    val seen = mutableListOf<String>()

    val collector = launch {
        effects.collect {
            seen += it
            firstEffect.complete(Unit)
        }
    }
    effects.subscriptionCount.first { it == 1 }
    status.value = "saved"
    effects.emit("저장 완료")
    firstEffect.await()
    collector.cancelAndJoin()

    effects.emit("화면이 닫힌 동안 저장")
    check(effects.replayCache.isEmpty())
    check(status.first() == "saved")

    val reopened = launch {
        effects.collect {
            seen += it
            secondEffect.complete(Unit)
        }
    }
    effects.subscriptionCount.first { it == 1 }
    effects.emit("새 저장")
    secondEffect.await()
    reopened.cancelAndJoin()
    check(collector.isCancelled && reopened.isCancelled)
    check(seen == listOf("저장 완료", "새 저장"))
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 화면이 다시 구독하면 저장 상태는 남아 있고 구독이 끊긴 동안 보낸 토스트는 전달되지 않는다. 화면이 없어도 처리해야 할 작업은 보관하고 처리 완료를 확인하는 별도 계약이 필요하다.

## 관련 문서

- [State](state.md)는 공유할 상태와 상태 전이를 모델링한다.
- [StateFlow](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-state-flow/)
- [SharedFlow](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-shared-flow/)
- [Compose 상태 호이스팅](https://developer.android.com/develop/ui/compose/state-hoisting)
- [Compose 컴파일러 설정](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler)
