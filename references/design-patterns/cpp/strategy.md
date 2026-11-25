# Strategy

## 목적

작업을 수행하는 코드와 알고리즘을 선택하는 코드를 분리한다. 호출자는 일정한 시그니처로 전략을 호출하고, 구성하는 쪽에서 동작을 정한다.

## 사용처

테스트와 운영에서 다른 알고리즘을 주입하거나, 실행 중 설정에 따라 동작을 교체해야 할 때 쓴다. 선택지가 한 곳의 짧은 분기에 모여 있고 구현도 작다면 함수 안에서 바로 분기해도 된다.

## 장단점

호출부를 그대로 두고 전략을 교체하거나 개별로 테스트할 수 있다. 구체 함수 객체는 인라인화할 수 있다. `std::function`은 여러 구체 타입을 같은 시그니처로 보관할 수 있지만, 간접 호출과 동적 할당이 발생할 수 있다. 가상 인터페이스도 간접 호출을 사용하며, 전략 객체의 소유권을 정해야 한다.

## 구현 방식

즉시 호출하는 동작에는 함수 객체를 전달한다. 호출을 지연하거나 다른 타입의 콜백을 같은 변수에 저장하려면 `std::function`을 고려한다. 콜백이 참조를 캡처하면 실행 시점까지 참조 대상이 살아 있어야 한다. 상태를 갖는 전략에 가상 인터페이스를 사용하고 기반 포인터로 삭제한다면 공개 가상 소멸자를 둔다.

## 예시

각 예시는 독립적인 C++17 프로그램이다. 블록을 `demo.cpp`로 저장해 `g++ -std=c++17 -Wall -Wextra -pedantic demo.cpp -o demo && ./demo`로 실행한다.

### 사례 1 — 호출할 때 함수 객체 주입

주문 금액은 공유하고, 고객별 할인 계산만 호출자가 넘긴다. 같은 금액에 두 전략을 전달해 각각 110과 99가 되는지 확인한다.

```cpp
#include <cassert>

template<class Discount>
int invoice_total(int subtotal, Discount discount) {
    const int net = discount(subtotal);
    return net + net / 10;
}

int main() {
    const auto regular = [](int subtotal) { return subtotal; };
    const int member_discount = 10;
    const auto member = [member_discount](int subtotal) {
        return subtotal - member_discount;
    };
    assert(invoice_total(100, regular) == 110);
    assert(invoice_total(100, member) == 99);
}
```

### 사례 2 — 실행 중 가상 전략 교체

같은 인코더 객체가 기본 모드와 대문자 모드를 번갈아 사용한다. 실행 중 전략을 교체한 뒤 이전 구현이 소멸하고 다음 호출에 새 구현이 적용되는지 확인한다. 입력은 예제를 위해 한 글자로 제한한다.

```cpp
#include <cassert>
#include <memory>
#include <utility>

struct Encoding {
    virtual ~Encoding() = default;
    virtual char encode(char value) const = 0;
};

struct Plain : Encoding {
    int& destructions;
    explicit Plain(int& count) : destructions(count) {}
    ~Plain() override { ++destructions; }
    char encode(char value) const override { return value; }
};

struct UpperA : Encoding {
    char encode(char value) const override { return value == 'a' ? 'A' : value; }
};

class Encoder {
    std::unique_ptr<Encoding> strategy_;

public:
    explicit Encoder(std::unique_ptr<Encoding> strategy) : strategy_(std::move(strategy)) {}
    void replace(std::unique_ptr<Encoding> strategy) { strategy_ = std::move(strategy); }
    char encode(char value) const { return strategy_->encode(value); }
};

int main() {
    int destructions = 0;
    Encoder encoder(std::make_unique<Plain>(destructions));
    assert(encoder.encode('a') == 'a');
    encoder.replace(std::make_unique<UpperA>());
    assert(destructions == 1);
    assert(encoder.encode('a') == 'A');
}
```

이 인코더의 생성자와 교체 함수에는 유효한 전략을 전달한다. 호출자가 빈 전략을 넘길 수 있는 API에서는 그 입력의 처리도 계약으로 정한다.

### 사례 3 — 나중에 실행할 콜백의 캡처 수명

설정을 만드는 함수는 먼저 종료되고, 반환한 콜백은 나중에 실행된다. 설정을 콜백이 공유 소유하도록 값으로 캡처한다. 외부의 약한 참조로 호출 전까지 설정이 살아 있고, 마지막 콜백을 제거하면 설정도 소멸하는지 확인한다.

```cpp
#include <cassert>
#include <functional>
#include <memory>

struct Options {
    int offset;
};

std::function<int(int)> make_rule(std::weak_ptr<Options>& observed) {
    auto options = std::make_shared<Options>(Options{5});
    observed = options;
    return [options](int n) { return n + options->offset; };
}

int main() {
    std::weak_ptr<Options> observed;
    auto rule = make_rule(observed);
    assert(!observed.expired());
    assert(rule(7) == 12);

    auto copy = rule;
    rule = nullptr;
    assert(!observed.expired());
    assert(copy(0) == 5);
    copy = nullptr;
    assert(observed.expired());
}
```

복사가 필요한 작은 값은 직접 값으로 캡처할 수 있다. 이 예시에서는 콜백 복사본이 같은 설정의 수명을 공유하는 계약을 확인한다.

## 관련 문서

- [Policy-based design](policy-based-design.md)에서 동작이 객체의 타입에 포함되는 경우를 다룬다.
- [Factory](factory.md)에서 전략 등을 구성에 맞게 생성하는 방식을 다룬다.
