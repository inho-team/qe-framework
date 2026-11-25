# Adapter

## 목적

외부 API에 맞춘 타입과 오류를 내부에서 사용하는 계약으로 변환한다. 외부 형식이 바뀌면 변환 경계에서 대응한다.

## 사용처

외부 응답에 null이 있거나 SDK마다 실패 표현이 다르면 도메인에 노출하기 전에 변환한다. 같은 계약을 쓰는 타입끼리 전달하고 변환이 한 번만 필요하면 함수 하나로 충분하다.

## 장단점

호출부가 공급자별 DTO와 예외를 알 필요가 없어진다. 다만 매핑 규칙을 유지해야 하며, 외부 값의 차이를 하나로 합칠 때 재시도할지 판단하는 데 필요한 정보가 사라질 수 있다.

## 구현 방식

외부 모델의 필수값, 선택값, 오류를 구분해서 매핑한다. 실패는 해당 API가 문서화한 오류만 내부 계약으로 바꾼다. 호출자가 요청을 취소하면 `CancellationException`을 전파한다. 캐시나 원격 조회 순서는 저장소가 맡는다.

## 예시

### 사례 1 — nullable 프로필을 도메인 모델로 변환

외부 DTO에서 비어 있는 ID는 잘못된 응답으로 처리한다. 표시 이름만 비어 있으면 기본 이름을 쓴다.

```kotlin
data class ExternalProfile(val id: String?, val nickname: String?)
data class Profile(val id: String, val displayName: String)

fun ExternalProfile.toDomain(): Profile {
    val profileId = requireNotNull(id?.trim()?.takeIf { it.isNotEmpty() }) {
        "profile id is required"
    }
    val name = nickname?.trim()?.takeIf { it.isNotEmpty() } ?: "이름 없음"
    return Profile(profileId, name)
}

fun main() {
    check(ExternalProfile(" A1 ", " 민지 ").toDomain() == Profile("A1", "민지"))
    check(ExternalProfile("A2", null).toDomain() == Profile("A2", "이름 없음"))
    check(runCatching { ExternalProfile("  ", "민지").toDomain() }
        .exceptionOrNull() is IllegalArgumentException)
}
```

[예시 실행](README.md#예시-실행) 명령으로 공백 제거, 기본 이름, 필수 ID 누락을 확인한다.

### 사례 2 — 플랫폼 고객 조회 오류 형식 통일

두 플랫폼 SDK를 대역으로 구현한다. 하나는 누락을 HTTP 상태로, 다른 하나는 예외로 표현한다. 두 어댑터는 같은 조회 계약을 제공한다.

```kotlin
sealed interface Lookup {
    data class Found(val name: String) : Lookup
    object Missing : Lookup
}

fun interface Directory {
    fun find(id: String): Lookup
}

data class HttpReply(val status: Int, val name: String?)
class RecordMissing : Exception()

class HttpDirectory(private val get: (String) -> HttpReply) : Directory {
    override fun find(id: String): Lookup {
        val reply = get(id)
        return when (reply.status) {
            200 -> Lookup.Found(checkNotNull(reply.name))
            404 -> Lookup.Missing
            else -> error("unexpected HTTP status ${reply.status}")
        }
    }
}

class SdkDirectory(private val get: (String) -> String) : Directory {
    override fun find(id: String): Lookup =
        try {
            Lookup.Found(get(id))
        } catch (_: RecordMissing) {
            Lookup.Missing
        }
}

fun main() {
    val http = HttpDirectory { id ->
        if (id == "1") HttpReply(200, "민지") else HttpReply(404, null)
    }
    val sdk = SdkDirectory { id ->
        if (id == "1") "민지" else throw RecordMissing()
    }

    for (directory in listOf(http, sdk)) {
        check(directory.find("1") == Lookup.Found("민지"))
        check(directory.find("2") == Lookup.Missing)
    }
    check(runCatching { HttpDirectory { HttpReply(503, null) }.find("1") }
        .exceptionOrNull() is IllegalStateException)
}
```

[예시 실행](README.md#예시-실행) 명령을 사용한다. 두 어댑터는 조회 성공과 미등록을 동일하게 반환한다. HTTP 503은 미등록으로 처리하지 않는다.

### 사례 3 — 원격 API 변환 중 취소 전파

파일을 읽는 API에서 `IOException`을 읽기 실패로 변환한다. API를 기다리는 동안 사용자가 화면을 닫으면 읽기 작업도 취소된다.

```kotlin
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

sealed interface FileResult {
    data class Ready(val text: String) : FileResult
    object Unavailable : FileResult
}

suspend fun load(get: suspend () -> String): FileResult =
    try {
        FileResult.Ready(get())
    } catch (_: IOException) {
        FileResult.Unavailable
    }

fun main() = runBlocking {
    check(load { "body" } == FileResult.Ready("body"))
    check(load { throw IOException("offline") } == FileResult.Unavailable)

    val started = CompletableDeferred<Unit>()
    var result: FileResult? = null
    val request = launch {
        result = load {
            started.complete(Unit)
            awaitCancellation()
        }
    }
    started.await()
    request.cancelAndJoin()
    check(request.isCancelled && result == null)
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 연결 실패는 `Unavailable`을 만들며, 취소된 요청에는 결과가 없다. 여러 오류를 공통 예외로 잡는 기존 코드가 있다면 취소 예외를 변환 전에 다시 던진다.

## 관련 문서

- [Repository](repository.md)는 변환된 데이터를 어디서 읽고 어떻게 저장할지 결정한다.
- [Kotlin 코루틴 취소](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
