# Repository

## 목적

도메인에 프로필 조회나 저장 같은 데이터 계약을 제공한다. 저장소가 캐시와 원격 데이터의 관계를 결정하므로 호출자는 저장 위치를 알 필요가 없다.

## 사용처

디스크와 네트워크를 함께 쓰거나 프로덕션 데이터 소스를 메모리 구현으로 바꿔 검증해야 할 때 쓰기 좋다. 하나의 데이터 소스를 한 곳에서만 사용하고 별도 정책이 없으면 프로젝트에 있는 클라이언트를 직접 호출해도 충분하다.

## 장단점

조회 순서와 갱신 실패 정책을 한곳에서 관리할 수 있다. 쓰기와 읽기가 동시에 일어나면 오래된 응답이 최신 캐시를 덮지 않도록 직렬화나 버전 비교가 필요할 수 있다. 구독으로 캐시 접근을 숨길 때는 구독마다 새 네트워크 요청을 보내는지도 확인한다.

## 구현 방식

호출부는 도메인 타입을 받는 인터페이스에 의존한다. 저장소가 로컬 값의 유효 기간, 원격 조회 순서, 갱신 실패 후 표시할 값을 결정한다. 외부 DTO를 도메인으로 바꾸는 책임은 변환 경계에 둔다. 오래된 데이터를 보존하는 정책이 있더라도 호출의 취소는 전파한다.

## 예시

### 사례 1 — 메모리 저장소를 주입해 프로필 조회

표시 이름을 읽는 유스케이스에 테스트용 프로필 저장소를 주입한다.

```kotlin
data class Profile(val id: String, val displayName: String)

interface ProfileRepository {
    fun find(id: String): Profile?
}

class MemoryProfiles(profiles: List<Profile>) : ProfileRepository {
    private val byId = profiles.associateBy(Profile::id)
    override fun find(id: String) = byId[id]
}

class DisplayName(private val profiles: ProfileRepository) {
    fun forUser(id: String): String = profiles.find(id)?.displayName ?: "탈퇴한 사용자"
}

fun main() {
    val name = DisplayName(MemoryProfiles(listOf(Profile("1", "민지"))))
    check(name.forUser("1") == "민지")
    check(name.forUser("2") == "탈퇴한 사용자")
}
```

[예시 실행](README.md#예시-실행) 명령으로 등록된 사용자와 누락된 사용자의 표시 이름을 확인한다.

### 사례 2 — 만료된 캐시를 원격 값으로 갱신

캐시가 유효하면 로컬 값을 반환한다. 만료됐거나 없으면 원격으로 읽고 성공한 값을 캐시에 저장한다. 예시에서는 단일 호출자가 쓰는 단조 시계의 경과 시간(초)을 주입한다.

```kotlin
import kotlinx.coroutines.runBlocking

data class Profile(val id: String, val name: String)
data class CachedProfile(val profile: Profile, val fetchedAt: Long)

class Profiles(
    private val cache: MutableMap<String, CachedProfile>,
    private val fetch: suspend (String) -> Profile,
    private val now: () -> Long
) {
    suspend fun find(id: String): Profile {
        val cached = cache[id]
        if (cached != null && now() - cached.fetchedAt < 60) {
            return cached.profile
        }

        val fresh = fetch(id)
        cache[id] = CachedProfile(fresh, now())
        return fresh
    }
}

fun main() = runBlocking {
    var time = 59L
    var calls = 0
    val old = Profile("42", "이전 이름")
    val cache = mutableMapOf("42" to CachedProfile(old, 0L))
    val profiles = Profiles(cache, fetch = { id ->
        calls++
        Profile(id, "새 이름")
    }, now = { time })

    check(profiles.find("42") == old && calls == 0)
    time = 60L
    val fresh = profiles.find("42")
    check(fresh == Profile("42", "새 이름") && calls == 1)
    check(cache["42"] == CachedProfile(fresh, 60L))
    check(profiles.find("42") == fresh && calls == 1)
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 만료 경계 전에는 원격 호출이 없고, 경계에 도달하면 한 번 호출한다. 성공한 원격 결과를 다음 조회에서 다시 사용한다. 원격 조회가 실패하면 기존 캐시는 남고 예외는 호출자에게 전파된다.

### 사례 3 — 구독 중 갱신 실패와 취소 처리

화면은 저장된 프로필을 먼저 표시한다. 연결 오류가 나면 저장된 값과 갱신 실패를 함께 전달한다. 구독을 취소하면 진행 중인 원격 요청도 종료된다.

```kotlin
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

data class ProfileView(val name: String, val refreshFailed: Boolean = false)

class Profiles(private var cachedName: String, private val fetch: suspend () -> String) {
    fun observe(): Flow<ProfileView> = flow {
        val previous = cachedName
        emit(ProfileView(previous))
        val fresh = try {
            fetch()
        } catch (_: IOException) {
            emit(ProfileView(previous, refreshFailed = true))
            return@flow
        }
        cachedName = fresh
        emit(ProfileView(fresh))
    }
}

fun main() = runBlocking {
    val stale = ProfileView("캐시 이름")
    val unavailable = Profiles(stale.name) { throw IOException("offline") }
    check(unavailable.observe().toList() == listOf(stale, stale.copy(refreshFailed = true)))
    check(unavailable.observe().first() == stale)

    val started = CompletableDeferred<Unit>()
    var fetchCleanedUp = false
    val pending = Profiles(stale.name) {
        started.complete(Unit)
        try {
            awaitCancellation()
        } finally {
            fetchCleanedUp = true
        }
    }
    val seen = mutableListOf<ProfileView>()
    val subscriber = launch { pending.observe().toList(seen) }

    started.await()
    subscriber.cancelAndJoin()
    check(subscriber.isCancelled && fetchCleanedUp)
    check(seen == listOf(stale))
    check(pending.observe().first() == stale)
}
```

[코루틴 실행 방법](README.md#예시-실행)을 따른다. 연결 오류는 기존 프로필과 실패 표시를 남긴다. 취소가 발생하면 요청의 `finally`가 실행되고 구독자는 처음 받은 값만 보관한다. 두 경우 모두 다시 구독해서 읽은 첫 값은 원래 캐시 값이다. 이 `Flow`는 구독별로 실행되므로 첫 값 다음까지 수집할 때마다 원격 요청을 보낸다. 예시에서는 한 번에 하나의 구독만 다룬다.

## 관련 문서

- [Adapter](adapter.md)는 데이터 소스가 반환한 외부 값을 내부 타입으로 변환한다.
- [Observer](observer.md)는 구독과 화면 수명을 연결한다.
- [Kotlin Flow 예외 처리](https://kotlinlang.org/docs/flow.html#flow-exceptions)
