# Strategy

## 목적

호출 흐름을 공유하면서 규칙이 바뀌는 부분을 함수나 인터페이스로 전달한다.

## 사용처

목록을 서로 다른 기준으로 정렬하거나 입력에 따라 처리 정책을 선택할 때 사용한다. 규칙이 하나로 고정되어 있으면 직접 호출로 충분하다.

## 장단점

함수 하나로 규칙을 교체하고 각 규칙을 따로 시험할 수 있다. 선택 지점이 분산되면 적용된 정책을 추적하기 어렵다.

## 구현 방식

연산이 하나라면 함수 타입을 받고, 관련된 연산과 상태를 함께 교체할 때는 작은 인터페이스를 고려한다. 오류나 취소가 필요한 정책은 함수 시그니처에 `context.Context`와 `error`를 포함한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 정렬 비교 함수

이름 길이로 목록을 정렬한다. 길이가 같으면 입력 순서를 유지한다.

```go
package pattern

import (
	"slices"
	"sort"
	"testing"
)

func TestStableNameSort(t *testing.T) {
	names := []string{"Eva", "Al", "Bo", "Dan"}
	sort.SliceStable(names, func(i, j int) bool {
		return len(names[i]) < len(names[j])
	})

	want := []string{"Al", "Bo", "Eva", "Dan"}
	if !slices.Equal(names, want) {
		t.Fatalf("got %v, want %v", names, want)
	}
}
```

길이가 짧은 이름이 먼저 오고 길이가 같은 이름은 처음 순서를 유지한다. `go test -v`로 확인한다.

### 사례 2 — 이름 있는 처리 함수

재고 처리 흐름에서 판매 채널에 따라 포장 단위를 선택한다.

```go
package pattern

import "testing"

type PackingPolicy func(quantity int) int

func singleItemBoxes(quantity int) int { return quantity }
func fourItemBoxes(quantity int) int   { return (quantity + 3) / 4 }

func shipmentBoxes(quantity int, pack PackingPolicy) int {
	return pack(quantity)
}

func TestPackingPolicies(t *testing.T) {
	policies := map[string]PackingPolicy{
		"retail":    singleItemBoxes,
		"wholesale": fourItemBoxes,
	}
	for channel, want := range map[string]int{"retail": 6, "wholesale": 2} {
		if got := shipmentBoxes(6, policies[channel]); got != want {
			t.Fatalf("%s: got %d, want %d", channel, got, want)
		}
	}
}
```

같은 수량을 처리해도 판매 채널에 따라 상자 수가 6개 또는 2개가 된다. `go test -v`로 확인한다.

### 사례 3 — 정책 실패와 취소 전파

재고 정책의 오류에 작업 이름을 덧붙이면서 호출자가 원인을 판별할 수 있게 한다.

```go
package pattern

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

var ErrShortage = errors.New("quantity exceeds available stock")

type ReservationPolicy func(context.Context, int) error

func reserve(ctx context.Context, amount int, policy ReservationPolicy) error {
	if err := policy(ctx, amount); err != nil {
		return fmt.Errorf("reserve stock: %w", err)
	}
	return nil
}

func TestReserveErrors(t *testing.T) {
	checkStock := func(ctx context.Context, amount int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if amount > 3 {
			return ErrShortage
		}
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := reserve(ctx, 4, checkStock); !errors.Is(err, ErrShortage) {
		t.Fatalf("excess quantity: %v", err)
	}
	cancel()
	if err := reserve(ctx, 1, checkStock); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled reservation: %v", err)
	}
}
```

`errors.Is`로 수량 부족과 취소를 각각 구분할 수 있다. `go test -v`로 확인한다.

## 관련 문서

- [의존성 주입](dependency-injection.md)은 서비스가 교체 가능한 구현을 받는 위치를 설명한다.
- [Go의 sort.SliceStable 문서](https://pkg.go.dev/sort#SliceStable)
