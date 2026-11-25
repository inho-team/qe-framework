# 의존성 주입

## 목적

서비스가 저장소나 자원을 직접 만들던 책임을 호출 시작점으로 옮긴다. 서비스는 받은 의존성을 사용하고, 생성과 종료를 맡는 코드는 자원의 수명을 볼 수 있다.

## 사용처

운영 저장소를 메모리 구현으로 바꿔 서비스 동작을 검증하거나 여러 서비스가 같은 자원을 사용할 때 생성자 주입이 유용하다. 부수 효과가 없는 단일 함수는 필요한 값을 인자로 받는 것만으로 충분하다.

## 장단점

공유 자원과 테스트 대역이 명시적으로 드러난다. 생성자와 호출부가 늘면 조립 코드가 길어지고, 인터페이스에 들어간 typed nil과 자원 종료 책임도 살펴야 한다.

## 구현 방식

소비자에게 필요한 메서드만 인터페이스에 두고 생성자에서 필수 구현을 받는다. 명령 진입점이나 그 근처에서 구현을 만들어 서비스를 조립한다. 구체 포인터가 nil인지 인터페이스에 담기 전에 확인하고 자원을 만든 쪽이 종료를 맡는다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 생성자로 저장소 전달

재고 서비스가 읽기 전용 저장소를 받아 재고 유무를 계산한다.

```go
package pattern

import (
	"context"
	"testing"
)

type StockReader interface {
	Quantity(context.Context, string) int
}

type Inventory struct{ stock StockReader }

func NewInventory(stock StockReader) Inventory {
	return Inventory{stock: stock}
}

func (s Inventory) Available(ctx context.Context, sku string) bool {
	return s.stock.Quantity(ctx, sku) > 0
}

type memoryStock map[string]int

func (m memoryStock) Quantity(_ context.Context, sku string) int {
	return m[sku]
}

func TestAvailable(t *testing.T) {
	inventory := NewInventory(memoryStock{"pen": 2})
	ctx := context.Background()
	if !inventory.Available(ctx, "pen") || inventory.Available(ctx, "ruler") {
		t.Fatal("availability does not match injected stock")
	}
}
```

주입한 메모리 저장소의 수량에 따라 재고가 있는 품목과 없는 품목을 판별한다. `go test -v`로 확인한다.

### 사례 2 — 명령 진입점에서 서비스 조립

명령의 진입 함수에서 같은 장부를 기록 서비스와 조회 서비스에 전달한다. 테스트에서는 진입 함수의 출력을 조사한다.

```go
package pattern

import (
	"fmt"
	"io"
	"strings"
	"testing"
)

type ledger struct{ total int }

func (l *ledger) Add(amount int) { l.total += amount }
func (l *ledger) Balance() int   { return l.total }

type ledgerWriter interface{ Add(int) }
type ledgerReader interface{ Balance() int }

type recorder struct{ book ledgerWriter }

func (r recorder) Record(amount int) { r.book.Add(amount) }

type reporter struct{ book ledgerReader }

func (r reporter) WriteBalance(out io.Writer) error {
	_, err := fmt.Fprintln(out, r.book.Balance())
	return err
}

func run(out io.Writer) error {
	book := &ledger{}
	records := recorder{book: book}
	reports := reporter{book: book}
	records.Record(40)
	records.Record(2)
	return reports.WriteBalance(out)
}

func TestCommandAssembly(t *testing.T) {
	var out strings.Builder
	if err := run(&out); err != nil {
		t.Fatal(err)
	}
	if out.String() != "42\n" {
		t.Fatalf("got %q", out.String())
	}
}
```

명령 출력이 `42`이면 두 서비스가 같은 장부를 사용하고 결과가 주입한 출력으로 전달됐음을 확인할 수 있다. `go test -v`로 확인한다.

### 사례 3 — typed nil과 자원 종료

자원을 여는 함수가 포인터를 반환한다. 조립 함수는 포인터를 인터페이스로 전달하기 전에 검사하고, 처리 오류가 나도 자원을 닫는다.

```go
package pattern

import (
	"errors"
	"testing"
)

var ErrMissingConnection = errors.New("missing connection")
var ErrQuery = errors.New("query failed")

type reader interface{ Read() error }

type connection struct {
	readErr    error
	closeCalls int
}

func (c *connection) Read() error { return c.readErr }
func (c *connection) Close()      { c.closeCalls++ }

func query(source reader) error { return source.Read() }

func run(open func() (*connection, error)) error {
	conn, err := open()
	if err != nil {
		return err
	}
	if conn == nil {
		return ErrMissingConnection
	}
	defer conn.Close()
	return query(conn)
}

func TestConnectionOwnership(t *testing.T) {
	var absent *connection
	var source reader = absent
	if source == nil {
		t.Fatal("expected an interface holding a typed nil")
	}
	if err := run(func() (*connection, error) { return absent, nil }); !errors.Is(err, ErrMissingConnection) {
		t.Fatalf("nil connection: got %v", err)
	}

	conn := &connection{readErr: ErrQuery}
	if err := run(func() (*connection, error) { return conn, nil }); !errors.Is(err, ErrQuery) {
		t.Fatalf("query: got %v", err)
	}
	if conn.closeCalls != 1 {
		t.Fatalf("Close called %d times", conn.closeCalls)
	}
}
```

인터페이스에 담긴 nil 포인터를 재현하고, 조립 함수가 nil을 거절하며 조회에 실패했을 때도 연 자원을 한 번 닫는지 확인한다. `go test -v`로 확인한다.

## 관련 문서

- [Adapter](adapter.md)는 의존성의 기존 API를 소비자의 계약으로 변환한다.
- [자원 정리](resource-cleanup.md)는 조립 함수가 소유한 자원을 반환 경로마다 닫는 방법을 설명한다.
- [Go FAQ의 nil 인터페이스 설명](https://go.dev/doc/faq#nil_error)
