# Decorator

## 목적

기존 호출 계약을 유지하면서 계측이나 검사를 추가한다. 호출부가 쓰는 타입은 그대로 두고 기본 동작을 실행하는 구현을 감싼다.

## 사용처

저장소의 읽기와 쓰기를 계측하거나 특정 연산에 검증을 추가할 때 쓴다. 호출 지점이 하나이고 정책도 그 위치에만 필요하면 해당 호출을 직접 감싸도 충분하다.

## 장단점

인터페이스 위임을 쓰면 기본 동작을 넘기는 메서드를 반복해서 작성할 필요가 없다. 여러 래퍼를 합성할 수 있지만 검사와 계측을 어느 순서로 적용할지 정해야 한다. 위임 대상의 내부 호출은 래퍼를 건너뛰므로 계측할 호출의 위치를 확인한다.

## 구현 방식

`Interface by delegate`로 기본 멤버를 넘긴다. 래퍼는 정책을 적용할 멤버를 재정의하고, 그 안에서 위임 대상을 호출한다. 위임 대상에서 발생한 오류는 기존 계약대로 전파한다. 래퍼의 검증이 새 오류를 만들면 적용 대상과 오류 조건을 알린다.

## 예시

### 사례 1 — 위임으로 읽기만 계측하는 저장소

저장소의 쓰기는 그대로 넘긴다. 읽기는 성공과 실패를 포함한 시도 횟수를 기록한다.

```kotlin
interface Store {
    fun read(key: String): String
    fun write(key: String, value: String)
}

class MemoryStore : Store {
    private val values = mutableMapOf<String, String>()

    override fun read(key: String) = values.getValue(key)

    override fun write(key: String, value: String) {
        values[key] = value
    }
}

class MeteredStore(private val delegate: Store) : Store by delegate {
    var readAttempts = 0
        private set

    override fun read(key: String): String {
        readAttempts++
        return delegate.read(key)
    }
}

fun main() {
    val store = MeteredStore(MemoryStore())
    store.write("title", "Kotlin")
    check(store.readAttempts == 0)
    check(store.read("title") == "Kotlin")
    check(runCatching { store.read("missing") }.exceptionOrNull() is NoSuchElementException)
    check(store.readAttempts == 2)
}
```

[예시 실행](README.md#예시-실행) 명령으로 쓰기 후 횟수가 0이고 읽기 성공과 실패 후 2인지 확인한다. 카운터는 단일 스레드 예시이며 여러 스레드에서 공유할 경우 계측 구현에 원자성을 보장해야 한다.

### 사례 2 — 출금에 한도 검사 추가

계좌 포트에서 출금만 한도 검사를 한다. 입금과 잔액 조회는 위임한다.

```kotlin
interface Account {
    val balance: Int
    fun deposit(amount: Int)
    fun withdraw(amount: Int)
}

class MemoryAccount : Account {
    override var balance = 0
        private set

    override fun deposit(amount: Int) {
        require(amount > 0)
        balance += amount
    }

    override fun withdraw(amount: Int) {
        require(amount in 1..balance)
        balance -= amount
    }
}

class LimitedAccount(private val account: Account, private val limit: Int) : Account by account {
    override fun withdraw(amount: Int) {
        require(amount <= limit) { "withdrawal limit exceeded" }
        account.withdraw(amount)
    }
}

fun main() {
    val account: Account = LimitedAccount(MemoryAccount(), 100)
    account.deposit(300)
    val error = runCatching { account.withdraw(101) }.exceptionOrNull()
    check(error is IllegalArgumentException && error.message == "withdrawal limit exceeded")
    check(account.balance == 300)
    account.withdraw(100)
    check(account.balance == 200)
}
```

[예시 실행](README.md#예시-실행) 명령을 사용한다. 한도를 넘긴 출금만 거절되고 잔액은 보존된다. 한도와 같은 금액은 출금된다.

### 사례 3 — 위임 대상의 내부 호출 추적

보고서의 `export`는 자신의 `render`를 호출한다. 래퍼가 동일한 메서드를 재정의했을 때 두 경로를 비교한다.

```kotlin
interface Report {
    fun export(): String
    fun render(): String
}

class TextReport : Report {
    override fun export() = render()
    override fun render() = "summary"
}

class TracedReport(private val delegate: Report) : Report by delegate {
    val traces = mutableListOf<String>()

    override fun render(): String {
        traces += "render"
        return delegate.render()
    }
}

fun main() {
    val report = TracedReport(TextReport())
    check(report.export() == "summary")
    check(report.traces.isEmpty())
    check(report.render() == "summary")
    check(report.traces == listOf("render"))
}
```

[예시 실행](README.md#예시-실행) 명령으로 위임된 `export`의 내부 호출에서는 기록이 비어 있고, 래퍼에 직접 호출하면 기록이 한 건 생기는지 확인한다. 내부 렌더링에도 정책이 필요하다면 `TextReport`가 별도의 렌더러를 주입받도록 하거나, 래퍼가 `export`의 실행 흐름을 맡도록 구성한다.

## 관련 문서

- [Adapter](adapter.md)는 외부 인터페이스를 내부 계약으로 바꾼다.
- [Kotlin 인터페이스 위임](https://kotlinlang.org/docs/delegation.html)
