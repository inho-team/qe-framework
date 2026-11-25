# Visitor

## 목적

닫힌 타입 집합에 적용할 연산을 데이터 선언과 분리한다. 방문자가 각 타입에 대한 동작을 맡으므로, 데이터에 새 메서드를 추가하지 않고 새 연산을 정의할 수 있다.

## 사용처

이벤트나 구문 노드처럼 대안은 한 곳에서 관리하고 출력과 집계 등 서로 다른 연산을 추가할 때 쓴다. 대안이 적고 한 곳에서만 읽는다면 값을 직접 검사하는 코드로 충분할 수 있다. 대안 타입을 외부 모듈이 독립적으로 추가해야 한다면 가상 인터페이스를 검토한다.

## 장단점

한 연산의 타입별 처리를 한 방문자에 모을 수 있다. 각 대안만 받는 오버로드를 두면 대안이 늘었을 때 빠진 처리가 컴파일에서 드러난다. 새 대안은 기존 방문자마다 반영해야 할 수 있으며, 암시적 변환이나 포괄 오버로드가 있으면 기존 함수가 새 타입을 받는 경우도 생긴다.

## 구현 방식

C++17에서는 `std::variant`로 대안의 집합을 선언하고 `std::visit`에 방문자를 넘긴다. 방문자는 현재 값에 맞는 오버로드를 호출한다. 모든 대안에 대해 호출할 수 있어야 하고, 하나의 `std::visit` 호출에서 가능한 반환 타입과 값 범주도 일치해야 한다. 상태를 가진 방문자는 필요한 참조의 수명을 호출 범위 안에서 관리한다.

## 예시

각 예시는 독립적인 C++17 프로그램이다. 블록을 `demo.cpp`로 저장해 `g++ -std=c++17 -Wall -Wextra -pedantic demo.cpp -o demo && ./demo`로 실행한다.

### 사례 1 — 이벤트 값에 출력 연산 적용

성공과 재시도 이벤트를 같은 로그에 쓴다. 데이터에 출력 메서드를 추가하지 않고 방문자에서 각 형식을 정의한다. 입력 순서대로 두 줄이 출력되는지 확인한다.

```cpp
#include <cassert>
#include <ostream>
#include <sstream>
#include <variant>
#include <vector>

struct Delivered { int bytes; };
struct Retried { int attempt; };
using Event = std::variant<Delivered, Retried>;

struct Print {
    std::ostream& output;
    void operator()(const Delivered& event) const {
        output << "delivered " << event.bytes << '\n';
    }
    void operator()(const Retried& event) const {
        output << "retry " << event.attempt << '\n';
    }
};

int main() {
    const std::vector<Event> events{Delivered{128}, Retried{2}, Delivered{64}};
    std::ostringstream output;
    for (const auto& event : events) std::visit(Print{output}, event);
    assert(output.str() == "delivered 128\nretry 2\ndelivered 64\n");
}
```

### 사례 2 — 같은 이벤트에 별도의 집계 연산 추가

사례 1의 데이터 타입과 입력을 그대로 사용하고, 새 방문자가 성공한 전송량과 재시도 횟수를 집계한다. 누적 전송량이 192이고 재시도 이벤트가 한 번인지 확인한다.

```cpp
#include <cassert>
#include <variant>
#include <vector>

struct Delivered { int bytes; };
struct Retried { int attempt; };
using Event = std::variant<Delivered, Retried>;

struct Totals {
    int bytes = 0;
    int retries = 0;
};

struct Accumulate {
    Totals& totals;
    void operator()(const Delivered& event) const { totals.bytes += event.bytes; }
    void operator()(const Retried&) const { ++totals.retries; }
};

int main() {
    const std::vector<Event> events{Delivered{128}, Retried{2}, Delivered{64}};
    Totals totals;
    for (const auto& event : events) std::visit(Accumulate{totals}, event);
    assert(totals.bytes == 192 && totals.retries == 1);
}
```

### 사례 3 — 새 이벤트의 처리 누락 검출

이벤트 이름을 반환하는 방문자가 기존 두 타입을 처리한다. `ADD_DROP`을 정의하면 `Dropped`를 대안에 추가한다. `g++ -std=c++17 -Wall -Wextra -pedantic -DADD_DROP -c demo.cpp`는 새 타입을 처리할 오버로드가 없어 컴파일에 실패한다. 같은 명령에서 `-c` 대신 `-DHANDLE_DROP -o demo`를 사용하고 `./demo`를 실행하면 세 대안을 모두 처리한다.

```cpp
#include <cassert>
#include <string_view>
#include <variant>

struct Delivered { int bytes; };
struct Retried { int attempt; };
struct Dropped { int reason; };

#ifdef ADD_DROP
using Event = std::variant<Delivered, Retried, Dropped>;
#else
using Event = std::variant<Delivered, Retried>;
#endif

struct Name {
    std::string_view operator()(const Delivered&) const { return "delivered"; }
    std::string_view operator()(const Retried&) const { return "retry"; }
#ifdef HANDLE_DROP
    std::string_view operator()(const Dropped&) const { return "dropped"; }
#endif
};

int main() {
    assert(std::visit(Name{}, Event{Delivered{128}}) == "delivered");
    assert(std::visit(Name{}, Event{Retried{2}}) == "retry");
#ifdef ADD_DROP
    assert(std::visit(Name{}, Event{Dropped{1}}) == "dropped");
#endif
}
```

## 관련 문서

- [Strategy](strategy.md)에서 실행 중 알고리즘을 교체하는 방식을 다룬다.
- [Factory](factory.md)에서 `variant`를 사용해 제품을 값으로 반환하는 방식을 다룬다.
