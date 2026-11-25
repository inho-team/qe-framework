# Factory

## 목적

설정과 입력을 해석해 제품과 생성 과정을 정하는 책임을 호출부에서 분리한다. 호출자는 결과의 공통 인터페이스나 값 타입을 사용한다.

## 사용처

여러 호출부가 같은 설정으로 구현체를 선택하거나, 제품 초기화에 실패할 수 있는 단계가 있을 때 쓴다. 한 곳에서 생성자 하나로 필요한 객체를 만들 수 있다면 생성자를 직접 호출해도 된다.

## 장단점

생성 분기와 실패 계약을 한 곳에서 관리할 수 있다. 다형 제품을 `unique_ptr`로 반환하면 단독 소유권이 드러나고, 동적 할당과 간접 호출이 발생할 수 있다. 값 타입을 사용하면 객체별 동적 할당을 피할 수 있는 경우가 있지만, 대안이 공개 타입에 드러나면 대안을 추가할 때 사용 모듈의 재빌드가 필요할 수 있다.

## 구현 방식

입력을 제품 선택으로 바꾼 뒤 초기화를 끝낸 결과를 반환한다. 소유 결과는 값이나 `std::unique_ptr<Base>`로 전달한다. 실패를 빈 결과, 오류 값, 예외 중 어떻게 전달하는지 API 계약에 명시한다. 부분 생성 중에는 획득한 자원을 즉시 소유 객체에 넣는다. 제품이 바이너리 경계를 건너면 어느 모듈에서 할당하고 해제할지 정하고, 필요한 경우 해당 모듈의 파괴 함수를 삭제자로 전달한다.

## 예시

각 예시는 독립적인 C++17 프로그램이다. 블록을 `demo.cpp`로 저장해 `g++ -std=c++17 -Wall -Wextra -pedantic demo.cpp -o demo && ./demo`로 실행한다.

### 사례 1 — 설정에 따라 다형 제품 생성

메시지 설정이 제품의 표시 동작을 선택한다. 팩터리는 단독 소유 포인터를 반환하고, 지원하지 않는 설정에는 빈 포인터를 반환한다. 설정 두 가지에 대해 동작을 확인하고 잘못된 설정도 검사한다.

```cpp
#include <cassert>
#include <memory>
#include <string_view>

struct Label {
    virtual ~Label() = default;
    virtual std::string_view text() const = 0;
};

struct ShortLabel : Label {
    std::string_view text() const override { return "OK"; }
};

struct LongLabel : Label {
    std::string_view text() const override { return "Accepted"; }
};

std::unique_ptr<Label> make_label(std::string_view mode) {
    if (mode == "short") return std::make_unique<ShortLabel>();
    if (mode == "long") return std::make_unique<LongLabel>();
    return {};
}

int main() {
    auto short_label = make_label("short");
    auto long_label = make_label("long");
    assert(short_label && short_label->text() == "OK");
    assert(long_label && long_label->text() == "Accepted");
    assert(!make_label("unknown"));
}
```

### 사례 2 — 닫힌 제품 집합에서 값 반환

일정 설정에서 한 번 실행하는 작업과 반복 작업을 고른다. 두 제품이 작은 값이고 공개된 대안으로 관리되므로 `variant`로 결과를 반환한다. 호출부에서 대안과 설정값을 확인한다.

```cpp
#include <cassert>
#include <variant>

struct Once { int hour; };
struct Recurring { int interval_hours; };
using Schedule = std::variant<Once, Recurring>;

Schedule make_schedule(bool repeat) {
    if (repeat) return Recurring{6};
    return Once{9};
}

int main() {
    const auto one_time = make_schedule(false);
    const auto polling = make_schedule(true);
    assert(std::get<Once>(one_time).hour == 9);
    assert(std::get<Recurring>(polling).interval_hours == 6);
}
```

### 사례 3 — 두 번째 자원을 얻지 못하면 첫 번째 자원 반환

두 채널이 모두 열려야 세션을 생성할 수 있다. 외부 서비스 대신 정수 자원을 사용하고, 팩터리는 두 번째 채널 열기에 실패하면 빈 결과를 반환한다. 실패 직후 첫 번째 자원이 한 번 정리되고, 별도의 정상 세션은 소멸 시 두 자원을 모두 정리하는지 확인한다.

```cpp
#include <cassert>
#include <memory>
#include <optional>
#include <utility>

struct Close {
    int& calls;
    void operator()(int* channel) const noexcept {
        ++calls;
        delete channel;
    }
};

using Channel = std::unique_ptr<int, Close>;

Channel open_channel(int id, bool available, int& closes) {
    return Channel(available ? new int(id) : nullptr, Close{closes});
}

struct Session {
    Channel input;
    Channel output;
};

std::optional<Session> make_session(bool output_available, int& closes) {
    auto input = open_channel(1, true, closes);
    auto output = open_channel(2, output_available, closes);
    if (!output) return std::nullopt;
    return Session{std::move(input), std::move(output)};
}

int main() {
    int failed_closes = 0;
    assert(!make_session(false, failed_closes));
    assert(failed_closes == 1);

    int normal_closes = 0;
    {
        auto session = make_session(true, normal_closes);
        assert(session && *session->input == 1 && *session->output == 2);
        assert(normal_closes == 0);
    }
    assert(normal_closes == 2);
}
```

이 예시에서 빈 결과는 채널을 열 수 없다는 뜻이다. 메모리 할당 예외는 호출부로 전파되며, 그때도 이미 소유한 채널이 정리된다.

## 관련 문서

- [RAII](raii.md)에서 생성과 해제를 수명에 연결하는 방식을 다룬다.
- [Strategy](strategy.md)에서 생성된 구현을 호출 코드에 주입하는 방식을 다룬다.
