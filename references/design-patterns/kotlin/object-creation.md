# 객체 생성

## 목적

호출부에서 설정값의 의미를 드러내고 올바른 인스턴스를 만드는 책임을 생성 경계에 둔다.

## 사용처

일부 설정만 바꿀 때는 이름 있는 인자와 기본값을 쓴다. 사용자 입력에 따라 생성 방식이 달라지거나 검증과 정규화가 필요하면 이름 있는 팩토리를 고려한다. 여러 단계나 중첩 블록이 도메인 구성을 설명할 때 DSL이 유용하다.

## 장단점

이름 있는 인자는 호출에 의미를 더하는 비용이 작다. 팩토리는 여러 경로를 의미 있는 이름으로 표현할 수 있지만, 새 생성 경로도 동일한 불변식을 보장해야 한다. DSL은 중첩된 설정을 읽기 쉽게 만들며, 수신 객체의 범위와 필수 값 누락 시점을 별도로 관리해야 한다.

## 구현 방식

생성자에는 기본값으로 충분한 필드를 선언한다. 입력을 검증한 뒤에만 객체를 만들려면 생성자를 닫고 팩토리에서 검증한다. DSL의 가변 상태는 빌드 과정에 두고 외부에는 검증을 마친 불변 객체를 돌려준다.

## 예시

### 사례 1 — 이름 있는 인자로 재시도 설정 구성

관리 화면의 호출은 대기 시간과 최대 시도 횟수 중 필요한 값만 바꾼다.

```kotlin
data class RetrySettings(
    val maxAttempts: Int = 3,
    val initialDelayMs: Long = 200,
    val jitter: Boolean = true
)

fun main() {
    val admin = RetrySettings(maxAttempts = 1)
    val background = RetrySettings(initialDelayMs = 500, jitter = false)

    check(admin == RetrySettings(maxAttempts = 1, initialDelayMs = 200, jitter = true))
    check(background.maxAttempts == 3)
    check(background.initialDelayMs == 500L && !background.jitter)
}
```

[예시 실행](README.md#예시-실행) 명령으로 이름을 지정한 값과 생략한 기본값을 확인한다.

### 사례 2 — 사용자 입력을 검증하는 이름 있는 팩토리

구독 코드는 양 끝 공백을 제거한 뒤 영문 대문자와 숫자로 이루어진 여섯 글자인지 검사한다. 생성자가 비공개이므로 외부 입력은 팩토리를 거친다.

```kotlin
class SubscriptionCode private constructor(val value: String) {
    companion object {
        private val format = Regex("[A-Z0-9]{6}")

        fun fromUserInput(input: String): SubscriptionCode {
            val code = input.trim()
            require(format.matches(code)) { "invalid subscription code" }
            return SubscriptionCode(code)
        }
    }
}

fun main() {
    check(SubscriptionCode.fromUserInput("  TRIAL7 ").value == "TRIAL7")
    check(runCatching {
        SubscriptionCode.fromUserInput("bad")
    }.exceptionOrNull() is IllegalArgumentException)
}
```

[예시 실행](README.md#예시-실행) 명령으로 입력이 정규화되고 형식에 맞지 않는 입력이 생성 전에 거절되는지 확인한다.

### 사례 3 — 배포 DSL에서 필수 대상 누락 처리

배포 이름과 대상 정보를 단계별로 입력한다. 대상 블록의 리전은 필수이며 구성 완료 시 검사한다.

```kotlin
data class Target(val region: String, val replicas: Int)
data class Deployment(val name: String, val target: Target)

@DslMarker
annotation class DeploymentDsl

@DeploymentDsl
class TargetBuilder {
    var region: String? = null
    var replicas: Int = 1

    internal fun build(): Target {
        val selectedRegion = checkNotNull(region?.takeIf { it.isNotBlank() }) {
            "target.region is required"
        }
        require(replicas > 0)
        return Target(selectedRegion, replicas)
    }
}

@DeploymentDsl
class DeploymentBuilder {
    private var target: Target? = null

    fun target(configure: TargetBuilder.() -> Unit) {
        target = TargetBuilder().apply(configure).build()
    }

    internal fun build(name: String): Deployment =
        Deployment(name, checkNotNull(target) { "target is required" })
}

fun deployment(name: String, configure: DeploymentBuilder.() -> Unit): Deployment =
    DeploymentBuilder().apply(configure).build(name)

fun main() {
    val ready = deployment("billing") { target { region = "seoul" } }
    check(ready == Deployment("billing", Target("seoul", 1)))

    val missingRegion = runCatching {
        deployment("billing") { target { replicas = 2 } }
    }.exceptionOrNull()
    val missingTarget = runCatching { deployment("billing") {} }.exceptionOrNull()
    check(missingRegion is IllegalStateException && missingRegion.message == "target.region is required")
    check(missingTarget is IllegalStateException && missingTarget.message == "target is required")
}
```

[예시 실행](README.md#예시-실행) 명령을 사용한다. 정상 입력은 불변 설정을 만들고, 리전과 대상 블록을 각각 빠뜨리면 어느 항목이 필요한지 오류가 알려 준다. `@DslMarker`는 내부 블록에서 외부 수신 객체를 암묵적으로 참조하는 것을 제한하며 필수 필드는 각 `build`에서 검사한다.

## 관련 문서

- [State](state.md)는 상태마다 필수인 값을 별도 타입으로 표현한다.
- [Kotlin 이름 있는 인자와 기본값](https://kotlinlang.org/docs/functions.html)
- [Kotlin 타입 안전 빌더](https://kotlinlang.org/docs/type-safe-builders.html)
