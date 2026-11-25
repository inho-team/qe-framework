# Policy-based design

## 목적

호스트 템플릿이 공통 흐름을 맡고, 정책 타입이 변환이나 할당 같은 특정 연산을 맡는다. 구체 정책은 인스턴스화할 때 결정된다.

## 사용처

동작 조합이 타입을 사용하는 코드에서 정해지고, 구체 연산을 컴파일러가 볼 수 있어야 할 때 쓴다. 함수 한 곳에서 한 번만 달라지는 동작은 함수에 호출 객체를 직접 전달하는 것으로 충분하다. 이미 생성된 객체의 동작을 실행 중에 교체하려면 [Strategy](strategy.md)의 조립 방식이 맞다.

## 장단점

구체 연산을 직접 호출하므로 컴파일러가 인라인화할 수 있고, 정책 조합의 계약을 컴파일할 때 확인할 수 있다. 정책 조합마다 별도의 타입이 생긴다. 인스턴스화가 늘면 컴파일 시간과 바이너리 크기에 영향을 줄 수 있으며, 정책의 요구 사항이 분명하지 않으면 호출자는 긴 템플릿 오류를 마주할 수 있다.

## 구현 방식

호스트가 호출할 연산의 인자와 반환값을 정한다. 정책을 템플릿 인자로 받고, 상태가 있는 정책은 호스트의 멤버로 보관한다. 저장소 정책은 획득한 저장소를 같은 계약으로 반환하는 책임을 진다. 컴파일 진단이 필요한 계약은 C++17의 타입 특성과 `static_assert`로 검사할 수 있다.

## 예시

각 예시는 독립적인 C++17 프로그램이다. 블록을 `demo.cpp`로 저장해 `g++ -std=c++17 -Wall -Wextra -pedantic demo.cpp -o demo && ./demo`로 실행한다. 사례 3은 실패 조건을 선택하는 빌드도 수행한다.

### 사례 1 — 호스트의 변환 정책 교체

센서 처리기는 원시값이 음수일 때 0으로 정규화하고, 출력 환산은 정책 타입에 맡긴다. 같은 입력을 두 인스턴스에 넘겨 정규화 흐름을 공유하면서 환산 결과가 달라지는지 확인한다.

```cpp
#include <cassert>

struct Identity {
    int operator()(int value) const { return value; }
};

struct Double {
    int operator()(int value) const { return value * 2; }
};

template<class Conversion>
class Reading {
    Conversion convert_;

public:
    int normalize(int raw) const { return convert_(raw < 0 ? 0 : raw); }
};

int main() {
    Reading<Identity> raw;
    Reading<Double> scaled;
    assert(raw.normalize(12) == 12);
    assert(scaled.normalize(12) == 24);
    assert(scaled.normalize(-5) == 0);
}
```

### 사례 2 — 표준 컨테이너에 할당 정책 전달

같은 `std::vector` 연산을 유지하면서 테스트에서 확보한 저장소가 컨테이너 소멸 시 모두 반환되는지 측정한다. 계수 객체는 컨테이너보다 오래 살아야 한다.

```cpp
#include <cassert>
#include <cstddef>
#include <memory>
#include <vector>

struct Counts {
    std::size_t allocated = 0;
    std::size_t released = 0;
};

template<class T>
struct CountingAllocator {
    using value_type = T;
    Counts* counts;

    explicit CountingAllocator(Counts& counter) noexcept : counts(&counter) {}
    template<class U>
    CountingAllocator(const CountingAllocator<U>& other) noexcept : counts(other.counts) {}

    T* allocate(std::size_t n) {
        T* storage = std::allocator<T>{}.allocate(n);
        counts->allocated += n;
        return storage;
    }
    void deallocate(T* storage, std::size_t n) noexcept {
        std::allocator<T>{}.deallocate(storage, n);
        counts->released += n;
    }

    template<class U>
    bool operator==(const CountingAllocator<U>& other) const noexcept {
        return counts == other.counts;
    }
    template<class U>
    bool operator!=(const CountingAllocator<U>& other) const noexcept {
        return !(*this == other);
    }
};

int main() {
    Counts counts;
    {
        std::vector<int, CountingAllocator<int>> items{CountingAllocator<int>{counts}};
        items.reserve(4);
        items.push_back(7);
        assert(items.front() == 7);
        assert(counts.allocated >= 4 && counts.released == 0);
    }
    assert(counts.allocated == counts.released);
}
```

### 사례 3 — 정책의 호출 계약을 컴파일할 때 확인

재시도 설정은 시도 횟수를 지역 변수에 보관하고, 이 변수를 lvalue로 정책에 전달한다. 정책은 이 인자를 받아 정수로 변환할 수 있는 지연 시간을 반환해야 한다. 기본 빌드에서 `int&`를 받는 정책은 3번째 시도의 지연 시간이 150ms인지 확인한다. 같은 파일을 `g++ -std=c++17 -Wall -Wextra -pedantic -DINVALID_POLICY -c demo.cpp`로 빌드하면 `int&&`만 받는 정책이 계약을 위반하므로 `RetryDelay policy must accept an int lvalue and return an int-compatible delay` 진단과 함께 실패한다.

```cpp
#include <cassert>
#include <type_traits>

template<class Delay>
struct RetryDelay {
    static_assert(std::is_invocable_r_v<int, const Delay&, int&>,
                  "RetryDelay policy must accept an int lvalue and return an int-compatible delay");
    Delay delay;
    int milliseconds(int attempt) const { return delay(attempt); }
};

struct LinearDelay {
    int operator()(int& attempt) const & { return 50 * attempt; }
};

struct InvalidDelay {
    int operator()(int&& attempt) const & { return 50 * attempt; }
};

int main() {
#ifdef INVALID_POLICY
    RetryDelay<InvalidDelay> retry{};
#else
    RetryDelay<LinearDelay> retry{};
    assert(retry.milliseconds(3) == 150);
#endif
    (void)retry;
}
```

## 관련 문서

- [Strategy](strategy.md)에서 알고리즘을 호출할 때 주입하거나 실행 중에 교체하는 방식을 다룬다.
- [Factory](factory.md)에서 입력에 따라 객체를 생성하고 소유권을 넘기는 방식을 다룬다.
