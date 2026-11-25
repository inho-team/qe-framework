# Strategy

## 목적

검색이나 결제 같은 작업의 흐름과 정책을 분리한다. 작업을 호출하는 쪽에서 정책을 고르고, 작업은 그 정책을 실행한다.

## 사용처

같은 검색 결과를 관련도나 인기도로 정렬할 때 함수 타입을 받는다. 정렬 기준이 하나로 고정되어 있으면 호출부의 `sortedByDescending`으로 충분하다.

## 장단점

람다는 호출부에서 정책의 차이를 드러낸다. `fun interface`는 메서드 이름을 붙이고 Java 쪽에서도 람다로 구현할 수 있는 계약을 제공한다. 정책을 외부에서 주입하면 부수 효과나 예외를 시그니처만으로 파악하기 어려우므로 실행 주체와 오류 계약을 함께 문서화한다.

## 구현 방식

Kotlin 호출에는 함수 타입을 쓰고, Java 사용자가 구현할 정책에는 이름 있는 인터페이스를 둔다. 원격 조회처럼 대기가 있는 정책은 `suspend` 함수로 받는다. 호출자의 코루틴에서 실행하며, 정책에서 발생할 수 있는 업무 오류와 취소를 구분한다.

## 예시

### 사례 1 — 함수 타입으로 검색 순위 계산

같은 검색 결과를 화면 탭에 따라 관련도나 인기도순으로 보여 준다.

```kotlin
data class Hit(val title: String, val relevance: Int, val views: Int)

fun rank(hits: List<Hit>, score: (Hit) -> Int): List<String> =
    hits.sortedByDescending(score).map { it.title }

fun main() {
    val hits = listOf(Hit("Kotlin", 90, 10), Hit("Gradle", 60, 30))
    check(rank(hits, Hit::relevance) == listOf("Kotlin", "Gradle"))
    check(rank(hits, Hit::views) == listOf("Gradle", "Kotlin"))
}
```

[예시 실행](README.md#예시-실행) 명령을 사용한다. 같은 목록에서 두 정책이 서로 다른 순서를 만들어야 두 검사를 통과한다. 정렬하는 동안 같은 항목의 점수를 여러 번 읽을 수 있으므로 점수 함수는 결과가 일정하고 부수 효과가 없도록 구성한다.

### 사례 2 — Java 호출자가 구현하는 할인 전략

Java 결제 모듈에서 할인 정책을 람다로 선택한다. Kotlin 코드는 `Pricing.kt`에 저장한다.

```kotlin
fun interface Discount {
    fun amountFor(subtotal: Int): Int
}

object Checkout {
    @JvmStatic
    fun total(subtotal: Int, discount: Discount): Int =
        subtotal - discount.amountFor(subtotal)
}
```

Java 코드는 같은 디렉터리의 `Client.java`에 저장한다.

```java
public class Client {
    public static void main(String[] args) {
        int total = Checkout.total(10_000, subtotal -> subtotal / 10);
        if (total != 9_000) {
            throw new AssertionError(total);
        }
        System.out.println(total);
    }
}
```

`kotlinc Pricing.kt -include-runtime -d pricing.jar`와 `javac -cp pricing.jar Client.java`를 실행한다. Windows에서 `java -cp ".;pricing.jar" Client`를 실행하면 `9000`을 출력한다. 다른 플랫폼에서는 클래스 경로 구분자 `:`를 쓴다.

### 사례 3 — 일시 중단 정책에서 업무 오류와 취소 구분

할당량 조회가 업무상 거절되면 호출자에게 사유를 반환한다. 스코프가 취소되면 정책도 중단하며, 업무 결과를 만들 수 없다.

```kotlin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class QuotaDenied : Exception()

enum class Decision { ALLOWED, DENIED }

suspend fun decide(checkQuota: suspend () -> Unit): Decision =
    try {
        checkQuota()
        Decision.ALLOWED
    } catch (_: QuotaDenied) {
        Decision.DENIED
    }

fun main() = runBlocking {
    check(decide {} == Decision.ALLOWED)
    check(decide { throw QuotaDenied() } == Decision.DENIED)

    val entered = CompletableDeferred<Unit>()
    var result: Decision? = null
    val job = launch {
        result = decide {
            entered.complete(Unit)
            awaitCancellation()
        }
    }
    entered.await()
    job.cancelAndJoin()
    check(job.isCancelled && result == null)
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 정상 실행과 거절은 각 결과를 반환한다. 정책이 실행을 시작한 뒤 작업을 취소하면 `isCancelled`가 참이고 결과는 비어 있어야 한다.

## 관련 문서

- [구조화된 동시성](structured-concurrency.md)은 정책을 실행하는 작업의 수명과 취소를 다룬다.
- [Kotlin 함수형 인터페이스](https://kotlinlang.org/docs/fun-interfaces.html)
