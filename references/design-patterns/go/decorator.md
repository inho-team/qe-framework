# Decorator

## 목적

기존 저장소와 같은 인터페이스로 호출을 감싸 계측이나 캐시를 추가한다. 저장소의 기본 동작은 기존 구현에 맡긴다.

## 사용처

계측을 여러 구현에 붙이거나 성공한 읽기 결과를 메모리에 보관할 때 사용한다. 단일 호출에만 로그가 필요하면 호출부에서 직접 기록할 수 있다.

## 장단점

기존 구현과 호출부를 유지한 채 부가 동작을 조합한다. 각 계층의 호출 비용이 추가되고, 캐시 일관성과 데코레이터를 감싸는 순서도 관리해야 한다.

## 구현 방식

데코레이터에 다음 구현을 저장하고 기존 인터페이스를 구현한다. 다음 호출로 전달할 context와 반환값, 오류는 기존 계약을 지킨다. 캐시를 쓰면 키와 유효 기간, 저장에서 제외할 결과를 정하고 공유 가변 상태의 동시 접근을 보호한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 저장소 호출 계측

계측 데코레이터가 저장소 호출 수를 기록하면서 기존 반환값을 전달한다.

```go
package pattern

import (
	"context"
	"sync/atomic"
	"testing"
)

type stockReader interface {
	Quantity(context.Context, string) (int, error)
}

type memoryStock map[string]int

func (m memoryStock) Quantity(_ context.Context, sku string) (int, error) {
	return m[sku], nil
}

type countedStock struct {
	next  stockReader
	calls atomic.Int64
}

func (s *countedStock) Quantity(ctx context.Context, sku string) (int, error) {
	s.calls.Add(1)
	return s.next.Quantity(ctx, sku)
}

func TestCountedStock(t *testing.T) {
	counter := &countedStock{next: memoryStock{"pen": 4}}
	var stock stockReader = counter
	got, err := stock.Quantity(context.Background(), "pen")
	if err != nil || got != 4 || counter.calls.Load() != 1 {
		t.Fatalf("got quantity %d, error %v, calls %d", got, err, counter.calls.Load())
	}
}
```

호출자가 같은 인터페이스로 수량 4를 얻고 호출 수가 1로 기록된다. `go test -v`로 확인한다.

### 사례 2 — 성공 결과 캐시와 우회

단일 호출자가 사용하는 상태 조회를 감싼다. 강제 새로고침은 캐시 조회를 건너뛰고, 성공할 때만 저장한다.

```go
package pattern

import (
	"errors"
	"testing"
)

type statusReader interface {
	Status(key string, refresh bool) (string, error)
}

type cachedStatus struct {
	next   statusReader
	values map[string]string
}

func (c *cachedStatus) Status(key string, refresh bool) (string, error) {
	if value, ok := c.values[key]; ok && !refresh {
		return value, nil
	}
	value, err := c.next.Status(key, refresh)
	if err == nil {
		c.values[key] = value
	}
	return value, err
}

type upstream struct{ calls int }

var errOffline = errors.New("status source offline")

func (u *upstream) Status(_ string, refresh bool) (string, error) {
	u.calls++
	if refresh {
		return "", errOffline
	}
	return "ready", nil
}

func TestCacheBypass(t *testing.T) {
	source := &upstream{}
	cache := &cachedStatus{next: source, values: make(map[string]string)}
	if got, err := cache.Status("index", false); got != "ready" || err != nil {
		t.Fatalf("initial status: %q, %v", got, err)
	}
	if _, err := cache.Status("index", true); !errors.Is(err, errOffline) {
		t.Fatalf("refresh error: %v", err)
	}
	if got, err := cache.Status("index", false); got != "ready" || err != nil || source.calls != 2 {
		t.Fatalf("cached status: %q, %v, calls %d", got, err, source.calls)
	}
}
```

실패한 새로고침은 오류를 반환하고 이전 성공 값을 보존한다. 세 번의 조회 중 두 번만 원본 저장소를 부른다. `go test -v`로 확인한다.

### 사례 3 — 호출 횟수와 context 보존

콜백을 감싸 실행 사실을 기록한다. 취소된 context도 바꾸지 않고 원래 구현으로 한 번 전달한다.

```go
package pattern

import (
	"context"
	"errors"
	"testing"
)

type readerFunc func(context.Context) error

func observe(next readerFunc, record func(error)) readerFunc {
	return func(ctx context.Context) error {
		err := next(ctx)
		record(err)
		return err
	}
}

func TestObservedCanceledRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var calls, observations int
	read := observe(func(received context.Context) error {
		calls++
		if received != ctx {
			t.Fatal("replaced request context")
		}
		return received.Err()
	}, func(err error) {
		observations++
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("observed %v", err)
		}
	})

	if err := read(ctx); !errors.Is(err, context.Canceled) || calls != 1 || observations != 1 {
		t.Fatalf("got %v, calls %d, observations %d", err, calls, observations)
	}
}
```

원래 구현과 기록 콜백이 한 번씩 호출되며 호출자에게 취소 오류가 전달된다. `go test -v`로 확인한다.

## 관련 문서

- [Middleware](middleware.md)는 HTTP 핸들러를 감싸며 요청이 다음 단계로 넘어가는 조건을 다룬다.
- [Go context 패키지](https://pkg.go.dev/context)
