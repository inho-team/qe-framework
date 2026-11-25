# 구조화된 동시성

## 목적

요청에서 시작한 비동기 작업의 수명을 요청에 묶는다. 스코프는 자식 작업의 종료를 기다리고, 취소가 발생하면 자식 작업에 전달한다.

## 사용처

요청에 필요한 서로 독립적인 조회를 동시에 실행하거나 화면이 닫힐 때 해당 요청을 함께 중단할 때 쓴다. 두 번째 조회가 첫 번째의 결과를 필요로 하면 같은 코루틴에서 순차 호출하면 된다.

## 장단점

스코프 경계를 보면 어떤 작업이 함께 실행되고 종료되는지 알 수 있다. 다만 병렬 조회가 동시에 연결이나 파일을 차지하므로 실제 서비스에서 동시 실행 비용을 살핀다. 실패한 자식 작업의 형제까지 취소할 때와 일부 결과를 유지할 때는 예외를 관찰하는 위치가 다르다.

## 구현 방식

모든 결과가 필요하면 `coroutineScope` 안에서 자식을 시작하고 결과를 기다린다. 예상 가능한 부분 실패를 독립적으로 처리할 때는 `supervisorScope`를 고려하고 각 `Deferred`의 예외를 확인한다. 부모의 취소는 두 스코프 모두 자식에 전달된다. 자식이 획득한 자원은 해당 자식의 `use`나 `finally`에서 닫는다.

## 예시

### 사례 1 — 요청에 필요한 두 조회를 병렬 실행

요청에 프로필 이름과 장바구니 상품 수가 모두 필요하다. 테스트 대역은 두 조회가 모두 시작돼야 결과를 돌려준다.

```kotlin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

data class Summary(val name: String, val cartSize: Int)

suspend fun summary(loadName: suspend () -> String, loadCart: suspend () -> Int): Summary =
    coroutineScope {
        val name = async { loadName() }
        val cart = async { loadCart() }
        Summary(name.await(), cart.await())
    }

fun main() = runBlocking {
    val nameStarted = CompletableDeferred<Unit>()
    val cartStarted = CompletableDeferred<Unit>()

    val result = withTimeout(5_000) {
        summary(loadName = {
            nameStarted.complete(Unit)
            cartStarted.await()
            "민지"
        }, loadCart = {
            cartStarted.complete(Unit)
            nameStarted.await()
            2
        })
    }

    check(result == Summary("민지", 2))
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 두 조회가 겹쳐서 진행되면 테스트 대역이 서로의 시작을 확인하고 요약을 만든다. 순차 실행으로 바꾸면 상대 조회가 시작되지 않아 테스트의 타임아웃이 발생한다.

### 사례 2 — 일부 공급자의 실패를 허용하는 수집

가격 공급자를 독립적으로 조회한다. 연결 오류가 난 결과와 다른 공급자가 반환한 값을 함께 호출부에 전달한다.

```kotlin
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.supervisorScope

sealed interface Quote {
    data class Price(val cents: Int) : Quote
    data class Unavailable(val provider: String) : Quote
}

suspend fun quotes(loadA: suspend () -> Int, loadB: suspend () -> Int): List<Quote> =
    supervisorScope {
        val requests = listOf("A" to async { loadA() }, "B" to async { loadB() })
        requests.map { (provider, price) ->
            try {
                Quote.Price(price.await())
            } catch (_: IOException) {
                Quote.Unavailable(provider)
            }
        }
    }

fun main() = runBlocking {
    val failed = CompletableDeferred<Unit>()
    val result = quotes(loadA = {
        failed.complete(Unit)
        throw IOException("offline")
    }, loadB = {
        failed.await()
        750
    })

    check(result == listOf(Quote.Unavailable("A"), Quote.Price(750)))
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. A가 실패해도 B가 끝나며 결과에는 A의 실패와 B의 가격이 모두 들어 있다. 처리 대상으로 정한 연결 오류만 변환하므로 다른 예외나 호출자 취소가 발생하면 스코프 밖으로 전달된다.

### 사례 3 — 부모를 취소했을 때 두 자식의 자원 정리

응답을 읽는 두 자식이 각각 연결을 연다. 부모가 취소되면 두 읽기를 중단하고 각 연결을 닫는다.

```kotlin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class Connection : AutoCloseable {
    var closed = false
        private set

    override fun close() {
        closed = true
    }
}

suspend fun read(open: () -> Connection, started: CompletableDeferred<Unit>) {
    open().use {
        started.complete(Unit)
        awaitCancellation()
    }
}

fun main() = runBlocking {
    val connections = List(2) { Connection() }
    val started = List(2) { CompletableDeferred<Unit>() }
    val readers = mutableListOf<Job>()
    val request = launch {
        coroutineScope {
            readers += launch { read({ connections[0] }, started[0]) }
            readers += launch { read({ connections[1] }, started[1]) }
        }
    }

    started.forEach { it.await() }
    request.cancelAndJoin()
    check(request.isCancelled)
    check(readers.size == 2 && readers.all { it.isCancelled })
    check(connections.all { it.closed })
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 두 읽기가 시작한 뒤 부모를 취소하고 종료를 기다린다. 부모와 두 자식이 모두 취소되고 연결 두 개가 닫혀야 한다. 예시의 `close`는 동기적으로 끝난다. 정리에 일시 중단이 필요하다면 꼭 필요한 정리 작업만 `withContext(NonCancellable)` 안에서 수행한다.

## 관련 문서

- [Strategy](strategy.md)는 스코프 안에서 실행하는 정책을 교체하는 방법을 다룬다.
- [Kotlin 코루틴 취소](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
- [Kotlin 코루틴 예외 처리와 감독](https://kotlinlang.org/docs/exception-handling.html#supervision)
