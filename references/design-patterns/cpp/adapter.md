# Adapter

## 목적

외부 API의 호출 형식, 오류 또는 소유권을 애플리케이션이 사용하는 계약으로 변환한다. 호출부가 외부 API의 세부 규칙을 반복해서 처리하는 일을 줄인다.

## 사용처

C 핸들을 여러 곳에서 사용하거나 외부 라이브러리의 오류 표현이 내부 계약과 다를 때 쓴다. 호출이 한 곳뿐이고 변환도 단순하다면 그 위치에 작은 변환 함수를 두는 것으로 충분하다.

## 장단점

자원 반환과 오류 변환을 한 경계에서 관리할 수 있다. 오류를 단순화하면서 재시도나 진단에 필요한 정보가 사라질 수 있다. 빌린 뷰는 복사 비용을 줄이지만 원본의 수명과 무효화 조건을 호출자가 지켜야 한다.

## 구현 방식

외부 호출을 감싸고 반환값을 소유하거나 빌리는 내부 타입으로 바꾼다. 성공, 예상 실패, 계약 위반에 각각 어떤 값을 전달할지 정한다. C 핸들은 해당 API가 정한 함수로 반환한다. 모듈 경계에서는 할당과 반환을 어느 모듈에서 수행할지, 어떤 타입이 바이너리 인터페이스를 건너는지 확인한다.

## 예시

각 예시는 독립적인 C++17 프로그램이다. 블록을 `demo.cpp`로 저장해 `g++ -std=c++17 -Wall -Wextra -pedantic demo.cpp -o demo && ./demo`로 실행한다. 외부 라이브러리는 예제 프로그램 안의 C 방식 함수로 대체한다.

### 사례 1 — C 핸들을 소유 타입으로 감싸기

핸들은 라이브러리의 닫기 함수로 반환해야 한다. 획득과 반환을 애플리케이션의 단독 소유 타입으로 표현한다. 정상 호출 후 핸들이 한 번 닫히고, 획득 실패 시 닫기가 호출되지 않는지 확인한다.

```cpp
#include <cassert>
#include <memory>
#include <new>

struct Device {};
int closes = 0;

extern "C" Device* device_open(int number) noexcept {
    return number == 1 ? new (std::nothrow) Device : nullptr;
}
extern "C" void device_close(Device* device) noexcept {
    ++closes;
    delete device;
}

using DeviceOwner = std::unique_ptr<Device, decltype(&device_close)>;

DeviceOwner open_device(int number) {
    return DeviceOwner(device_open(number), &device_close);
}

int main() {
    {
        auto device = open_device(1);
        assert(device && closes == 0);
    }
    assert(closes == 1);
    {
        auto missing = open_device(2);
        assert(!missing);
    }
    assert(closes == 1);
}
```

### 사례 2 — 상태 코드와 출력 인자를 내부 결과로 변환

외부 조회 함수는 성공 시에만 출력 인자에 값을 쓴다. 어댑터는 성공 값, 누락, 조회 불가를 구분한다. 성공·누락·조회 불가 각각의 결과를 확인한다.

```cpp
#include <cassert>
#include <variant>

extern "C" int lookup(int id, int* value) {
    if (id < 0) return 5;
    if (id != 42) return 2;
    *value = 17;
    return 0;
}

enum class LookupError { missing, unavailable };
using Result = std::variant<int, LookupError>;

Result read_value(int id) {
    int value{};
    switch (lookup(id, &value)) {
    case 0: return value;
    case 2: return LookupError::missing;
    default: return LookupError::unavailable;
    }
}

int main() {
    assert(std::get<int>(read_value(42)) == 17);
    assert(std::get<LookupError>(read_value(0)) == LookupError::missing);
    assert(std::get<LookupError>(read_value(-1)) == LookupError::unavailable);
}
```

### 사례 3 — 임시 원본에서 뷰를 꺼내는 호출 차단

헤더 문자열을 소유하는 어댑터가 읽기 전용 뷰를 제공한다. 이름이 있는 원본으로 만든 뷰는 원본의 범위 안에서 읽을 수 있다. `g++ -std=c++17 -Wall -Wextra -pedantic -DDANGLING_VIEW -c demo.cpp`로 빌드하면 임시 원본의 삭제된 함수가 선택되어 컴파일이 실패한다.

```cpp
#include <cassert>
#include <string>
#include <string_view>

class Header {
    std::string text_ = "content-type";

public:
    std::string_view view() const & noexcept { return text_; }
    std::string_view view() const && = delete;
};

int main() {
    Header header;
    assert(header.view() == "content-type");
#ifdef DANGLING_VIEW
    auto view = Header{}.view();
    (void)view;
#endif
}
```

이 API는 임시 객체에 대한 직접 호출을 차단한다. 이름 있는 원본에서 꺼낸 뷰에도 수명 제약이 적용되며, 오래 보관해야 하는 호출부는 소유 문자열로 복사한다.

## 관련 문서

- [RAII](raii.md)에서 자원 반환을 객체 수명에 묶는 방법을 다룬다.
- [Pimpl](pimpl.md)에서 공개 헤더의 구현 의존성을 숨기는 방법을 다룬다.
