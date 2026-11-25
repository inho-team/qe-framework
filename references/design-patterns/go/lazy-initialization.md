# 지연 초기화

## 목적

공유 값의 준비 비용을 처음 필요한 시점으로 미룬다. 초기화와 접근 시점의 동기화는 값을 소유한 객체가 맡는다.

## 사용처

프로세스에서 한 번 준비할 값이 특정 경로에서만 필요할 때 사용한다. 모든 실행에서 곧바로 사용할 가벼운 값은 시작할 때 만들 수 있다.

## 장단점

쓰이지 않는 값의 준비 비용을 피하고 동시 호출에서 초기화 코드를 공유한다. 첫 호출에 비용이 집중되고, 실패를 저장할지 다시 시도할지 결정해야 한다.

## 구현 방식

공유 객체의 수명이 명확하면 `sync.Once`나 값을 반환하는 `sync.OnceValue`를 고려한다. `sync.OnceValues`를 쓰면 오류처럼 반환된 두 번째 값도 저장한다. 실패 뒤 재시도할 때는 성공 여부와 값을 잠금으로 보호하고 성공한 값만 공개한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 불변 설정 준비

여러 번 참조하는 설정을 첫 접근에서 한 번 읽는다. 설정 구조체는 복사 가능한 값 필드만 사용한다.

```go
package pattern

import (
	"sync"
	"testing"
)

type Settings struct{ Region string }

func TestSettingsAreLazy(t *testing.T) {
	loads := 0
	settings := sync.OnceValue(func() Settings {
		loads++
		return Settings{Region: "seoul"}
	})
	if loads != 0 {
		t.Fatal("settings loaded before first access")
	}
	first := settings()
	first.Region = "local copy"
	if second := settings(); second.Region != "seoul" || loads != 1 {
		t.Fatalf("got %+v after %d loads", second, loads)
	}
}
```

첫 접근이 준비를 시작하고 다음 접근에서는 같은 설정값을 얻는다. 반환된 복사본을 바꿔도 저장된 값은 유지된다. `go test -v`로 확인한다.

### 사례 2 — 동시 최초 접근

여러 고루틴이 시작 신호를 기다렸다가 같은 테이블에 접근한다. 초기화 횟수는 모든 호출이 종료된 뒤 확인한다.

```go
package pattern

import (
	"sync"
	"testing"
)

type table struct {
	once  sync.Once
	load  func() int
	value int
}

func (t *table) lookup() int {
	t.once.Do(func() { t.value = t.load() })
	return t.value
}

func TestConcurrentFirstAccess(t *testing.T) {
	loads := 0
	values := &table{load: func() int {
		loads++
		return 42
	}}
	start := make(chan struct{})
	var group sync.WaitGroup
	group.Add(8)
	for range 8 {
		go func() {
			defer group.Done()
			<-start
			if got := values.lookup(); got != 42 {
				t.Errorf("got %d, want 42", got)
			}
		}()
	}
	close(start)
	group.Wait()
	if loads != 1 {
		t.Fatalf("initialized %d times", loads)
	}
}
```

여덟 호출이 준비된 값 42를 얻고 초기화는 한 번만 실행된다. `go test -race -v -timeout 10s`로 확인한다.

### 사례 3 — 실패 뒤 재시도

설정 공급자가 첫 호출에서 일시 오류를 반환하고 두 번째 호출에서 성공한다. 잠금 안에서 상태를 확인하고 성공한 값을 보관한다.

```go
package pattern

import (
	"errors"
	"sync"
	"testing"
)

type retrySetting struct {
	mu    sync.Mutex
	load  func() (string, error)
	ready bool
	value string
}

func (s *retrySetting) get() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.ready {
		return s.value, nil
	}
	value, err := s.load()
	if err != nil {
		return "", err
	}
	s.value = value
	s.ready = true
	return value, nil
}

func TestRetryThenCache(t *testing.T) {
	errTemporary := errors.New("temporary failure")
	calls := 0
	settings := &retrySetting{load: func() (string, error) {
		calls++
		if calls == 1 {
			return "", errTemporary
		}
		return "ready", nil
	}}
	if _, err := settings.get(); !errors.Is(err, errTemporary) {
		t.Fatalf("first access: %v", err)
	}
	for range 2 {
		if got, err := settings.get(); got != "ready" || err != nil {
			t.Fatalf("got %q, %v", got, err)
		}
	}
	if calls != 2 {
		t.Fatalf("loader called %d times", calls)
	}
}
```

첫 호출은 오류를 받고 두 번째 호출은 초기화를 다시 시도한다. 세 번째 호출은 저장된 값을 읽으므로 실제 준비는 총 두 번 실행된다. 준비 중에는 같은 잠금을 기다리는 호출이 대기한다. `go test -v`로 확인한다.

## 관련 문서

- [의존성 주입](dependency-injection.md)은 실행 진입점에서 공유 구현을 만든 뒤 소비자에게 전달하는 방법을 다룬다.
- [Go의 sync.Once와 OnceValue 문서](https://pkg.go.dev/sync#Once)
- [Go의 sync.OnceValues 문서](https://pkg.go.dev/sync#OnceValues)
