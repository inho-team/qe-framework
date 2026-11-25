# Pimpl

## 목적

공개 클래스의 선언과 구현 전용 자료형의 정의를 분리한다. 사용자는 공개 헤더로 클래스를 사용할 수 있고, 구현 파일이 내부 구조와 관련 헤더에 의존한다.

## 사용처

여러 번역 단위에서 쓰는 공개 클래스의 내부 의존성이 자주 바뀌거나, 구현 전용 타입이 공개 헤더를 통해 여러 모듈에 퍼질 때 쓴다. 구현이 작고 의존성이 안정적이거나 클래스가 구현 파일에만 쓰이면 일반 값 멤버로 충분하다.

## 장단점

구현 전용 헤더 변경으로 사용 모듈을 다시 빌드하는 일을 줄일 수 있다. 구현 객체의 추가 할당과 포인터 간접 참조가 발생한다. 복사와 이동의 의미도 직접 정해야 한다. 바이너리 호환성을 유지해야 한다면 공개 타입의 배치, 시그니처, 컴파일러와 표준 라이브러리의 ABI도 확인한다.

## 구현 방식

공개 헤더에서 `Impl`을 전방 선언하고 `std::unique_ptr<Impl>`로 소유한다. 구현 파일에서 `Impl`을 정의한 뒤, 구현을 할당하는 생성자와 삭제가 일어날 수 있는 소멸자 및 이동 대입 연산을 정의한다. 이동을 지원한다면 이동 생성자도 구현 파일에 함께 정의하고, 이동된 객체에 허용할 연산을 정한다. 깊은 복사가 필요하면 내부 데이터를 복사하는 연산을 구현 파일에 정의한다.

## 예시

각 사례는 별도 디렉터리의 C++17 예제다. 블록을 표시된 파일 이름으로 저장하고 각 사례의 명령으로 빌드한다.

### 사례 1 — 전방 선언으로 구현 전용 헤더 숨기기

문자열 키로 접속 횟수를 기록한다. 구현 파일만 `<unordered_map>`을 사용하고, 호출부는 공개 헤더만 포함해 등록 횟수를 검사한다.

```sh
g++ -std=c++17 -Wall -Wextra -pedantic registry.cpp main.cpp -o demo && ./demo
```

`registry.hpp`

```cpp
#pragma once
#include <memory>
#include <string>

class Registry {
    struct Impl;
    std::unique_ptr<Impl> impl_;

public:
    Registry();
    ~Registry();
    int record(const std::string& key);
};
```

`registry.cpp`

```cpp
#include "registry.hpp"
#include <unordered_map>

struct Registry::Impl {
    std::unordered_map<std::string, int> hits;
};

Registry::Registry() : impl_(std::make_unique<Impl>()) {}
Registry::~Registry() = default;

int Registry::record(const std::string& key) {
    return ++impl_->hits[key];
}
```

`main.cpp`

```cpp
#include "registry.hpp"
#include <cassert>

int main() {
    Registry registry;
    assert(registry.record("home") == 1);
    assert(registry.record("home") == 2);
    assert(registry.record("search") == 1);
}
```

### 사례 2 — 이동 연산을 구현 파일에 정의

버퍼의 소유권을 이동 생성과 이동 대입으로 넘긴다. 새 소유자가 원래 크기를 보고하고, 이동된 객체를 다시 대입 대상으로 쓸 수 있는지 확인한다. 이 클래스의 `size()`는 버퍼를 소유한 객체에서 호출한다.

```sh
g++ -std=c++17 -Wall -Wextra -pedantic buffer.cpp main.cpp -o demo && ./demo
```

`buffer.hpp`

```cpp
#pragma once
#include <cstddef>
#include <memory>

class Buffer {
    struct Impl;
    std::unique_ptr<Impl> impl_;

public:
    explicit Buffer(std::size_t size);
    ~Buffer();
    Buffer(Buffer&&) noexcept;
    Buffer& operator=(Buffer&&) noexcept;
    std::size_t size() const;
};
```

`buffer.cpp`

```cpp
#include "buffer.hpp"
#include <vector>

struct Buffer::Impl {
    explicit Impl(std::size_t size) : bytes(size) {}
    std::vector<unsigned char> bytes;
};

Buffer::Buffer(std::size_t size) : impl_(std::make_unique<Impl>(size)) {}
Buffer::~Buffer() = default;
Buffer::Buffer(Buffer&&) noexcept = default;
Buffer& Buffer::operator=(Buffer&&) noexcept = default;

std::size_t Buffer::size() const {
    return impl_->bytes.size();
}
```

`main.cpp`

```cpp
#include "buffer.hpp"
#include <cassert>
#include <type_traits>
#include <utility>

int main() {
    static_assert(std::is_nothrow_move_constructible_v<Buffer>);
    static_assert(std::is_nothrow_move_assignable_v<Buffer>);
    static_assert(!std::is_copy_constructible_v<Buffer>);

    Buffer first(8);
    Buffer second(std::move(first));
    assert(second.size() == 8);
    Buffer third(2);
    third = std::move(second);
    assert(third.size() == 8);
    first = Buffer(4);
    assert(first.size() == 4);
}
```

### 사례 3 — 불완전 타입에서 기본 소멸자 정의 시 진단

호출부는 구현 타입의 정의를 볼 수 없는 상태에서 소유 객체를 생성하고 소멸한다. 기본 빌드에서는 구현 파일에서 정의한 소멸자를 호출한다. `INLINE_DESTRUCTOR`를 정의하고 호출부만 컴파일하면 `unique_ptr`의 기본 삭제자가 불완전 타입을 삭제하려고 하므로 실패한다.

```sh
g++ -std=c++17 -Wall -Wextra -pedantic connection.cpp main.cpp -o demo && ./demo
g++ -std=c++17 -Wall -Wextra -pedantic -DINLINE_DESTRUCTOR -c main.cpp
```

`connection.hpp`

```cpp
#pragma once
#include <memory>

class Connection {
    struct Impl;
    std::unique_ptr<Impl> impl_;

public:
    Connection();
#ifdef INLINE_DESTRUCTOR
    ~Connection() = default;
#else
    ~Connection();
#endif
    int port() const;
};
```

`connection.cpp`

```cpp
#include "connection.hpp"

struct Connection::Impl {
    int port = 8080;
};

Connection::Connection() : impl_(std::make_unique<Impl>()) {}
#ifndef INLINE_DESTRUCTOR
Connection::~Connection() = default;
#endif
int Connection::port() const { return impl_->port; }
```

`main.cpp`

```cpp
#include "connection.hpp"
#include <cassert>

int main() {
    Connection connection;
    assert(connection.port() == 8080);
}
```

## 관련 문서

- [RAII](raii.md)에서 `unique_ptr`의 소유권과 정리 시점을 다룬다.
- [Adapter](adapter.md)에서 외부 모듈의 호출 계약을 바꾸는 방식을 다룬다.
