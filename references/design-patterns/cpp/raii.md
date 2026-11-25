# RAII

## 목적

자원의 획득과 반환을 객체의 생성과 소멸에 연결한다. 호출자는 작업을 수행하고, 소유 객체는 정상 반환, 조기 반환, 예외로 범위를 벗어날 때 자원을 정리한다.

## 사용처

파일, 잠금, C API 핸들처럼 사용이 끝나면 정해진 연산을 호출해야 하는 자원에 쓴다. 표준 라이브러리가 자원을 이미 소유하는 경우에는 해당 객체를 값으로 사용하면 된다.

## 장단점

호출 경로마다 정리 코드를 반복할 필요가 없고, 부분 초기화 중 이미 생성된 소유 객체도 정리된다. 해제 시점은 소유 객체의 수명에 따르므로 수명이 길어지면 잠금이나 핸들을 더 오래 보유한다. 소멸자는 닫기 실패를 반환할 수 없으므로, 쓰기 완료를 보장해야 하는 코드는 닫기 오류를 확인하는 경계를 따로 둔다.

## 구현 방식

표준 자원 래퍼를 먼저 검토하고, C 자원은 사용자 정의 삭제자가 있는 `unique_ptr`로 소유할 수 있다. 빈 포인터의 의미를 정하고, 획득에 성공한 자원만 소유자에 넣는다. 단독 소유권을 이동하면 원래 소유자는 비게 된다. 정리 중 삭제자에서 예외가 빠져나오지 않게 하고, 오류를 호출자에게 전달해야 하는 연산은 명시적으로 호출한다.

## 예시

각 예시는 독립적인 C++17 프로그램이다. 블록을 `demo.cpp`로 저장해 `g++ -std=c++17 -Wall -Wextra -pedantic demo.cpp -o demo && ./demo`로 확인한다. 사례 2는 빌드 명령에 `-pthread`를 추가하고, 사례 3은 예외를 사용할 수 있어야 한다.

### 사례 1 — 파일 핸들의 고유 소유권

세션 데이터를 임시 파일에 읽고 쓴다. 임시 파일을 생성할 수 있는 환경이 필요하다. 정상 범위 종료 후 삭제자가 한 번 호출되는지 확인한다. 실제 쓰기 작업에서 닫기 오류도 성공 여부에 반영해야 한다면 `fclose`의 결과를 별도로 확인한다.

```cpp
#include <cassert>
#include <cstdio>
#include <memory>

struct CloseFile {
    int& calls;
    void operator()(std::FILE* file) const noexcept {
        ++calls;
        std::fclose(file);
    }
};

int main() {
    int closes = 0;
    {
        std::unique_ptr<std::FILE, CloseFile> file(std::tmpfile(), CloseFile{closes});
        if (!file) return 1;
        if (std::fputs("ready", file.get()) == EOF) return 2;
        std::rewind(file.get());
        char line[8]{};
        if (!std::fgets(line, sizeof line, file.get())) return 3;
        assert(line[0] == 'r');
        assert(closes == 0);
    }
    assert(closes == 1);
}
```

### 사례 2 — 조기 반환에서 잠금 해제

출금 요청액이 0 이하이거나 잔액보다 많으면 임계 구역에서 바로 반환한다. 실패와 성공 직후 각각 같은 뮤텍스를 잠그고 잔액을 읽어, 두 경로 모두 잠금을 반환하는지 확인한다.

```cpp
#include <cassert>
#include <mutex>

class Account {
    int balance_ = 10;
    std::mutex mutex_;

public:
    bool withdraw(int amount) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (amount <= 0 || amount > balance_) return false;
        balance_ -= amount;
        return true;
    }

    int balance() {
        std::lock_guard<std::mutex> lock(mutex_);
        return balance_;
    }
};

int main() {
    Account account;
    const bool failed = account.withdraw(11);
    assert(!failed && account.balance() == 10);
    const bool paid = account.withdraw(10);
    assert(paid && account.balance() == 0);
}
```

### 사례 3 — 이동과 예외 뒤에도 한 번만 정리

자원 소유권을 함수 안에서 새 객체로 넘긴 뒤 작업을 진행한다. 이동 상태와 정상 반환 및 예외 경로 각각의 해제 횟수를 확인한다.

```cpp
#include <cassert>
#include <memory>
#include <stdexcept>
#include <utility>

struct Release {
    int& calls;
    void operator()(int* resource) const noexcept {
        ++calls;
        delete resource;
    }
};

void process(int& releases, bool fail) {
    std::unique_ptr<int, Release> original(new int(42), Release{releases});
    auto owner = std::move(original);
    assert(!original && *owner == 42);
    if (fail) throw std::runtime_error("processing failed");
}

int main() {
    int normal = 0;
    process(normal, false);
    assert(normal == 1);

    int failed = 0;
    try {
        process(failed, true);
        return 1;
    } catch (const std::runtime_error&) {
        assert(failed == 1);
    }
}
```

## 관련 문서

- [Adapter](adapter.md)에서 외부 핸들의 계약까지 변환하는 방식을 다룬다.
- [Factory](factory.md)에서 생성 도중 실패할 때 이미 획득한 자원을 정리하는 방식을 다룬다.
