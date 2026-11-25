# Adapter

## 목적

외부 API나 기존 구현이 제공하는 데이터와 메서드를 소비자가 사용할 계약으로 바꾼다. 변환은 경계에 두고 서비스는 내부 타입과 오류로 판단한다.

## 사용처

외부 SDK가 문자열 식별자를 돌려주지만 도메인은 숫자 식별자를 쓸 때 유용하다. 같은 메서드와 의미를 이미 제공하는 구현은 Go의 암시적 인터페이스 구현을 이용해 직접 전달할 수 있다.

## 장단점

SDK 변경과 외부 오류 처리의 영향 범위가 좁아진다. 변환 규칙과 오류의 공개 범위를 따로 관리해야 하고, 어댑터가 늘면 실제 호출을 찾는 단계도 늘어난다.

## 구현 방식

소비자 패키지에 필요한 메서드만 인터페이스로 선언한다. 어댑터는 받은 context를 외부 호출에 전달하고, 입력과 출력을 한 곳에서 변환한다. 호출자가 구분해야 하는 오류는 내부 센티널에 매핑하거나 `%w`로 감싸 `errors.Is` 계약을 보존한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 외부 응답 변환

배송 SDK의 응답을 숫자 식별자로 바꾼다. 실패 상태나 잘못된 식별자는 내부 오류로 표현한다.

```go
package pattern

import (
	"errors"
	"strconv"
	"testing"
)

var ErrInvalidShipment = errors.New("invalid shipment")

type sdkResponse struct {
	Status int
	ID     string
}

type Shipment struct{ ID int }

func shipmentFrom(response sdkResponse) (Shipment, error) {
	id, err := strconv.Atoi(response.ID)
	if response.Status != 200 || err != nil || id <= 0 {
		return Shipment{}, ErrInvalidShipment
	}
	return Shipment{ID: id}, nil
}

func TestShipmentConversion(t *testing.T) {
	got, err := shipmentFrom(sdkResponse{Status: 200, ID: "42"})
	if err != nil || got.ID != 42 {
		t.Fatalf("got %+v, %v", got, err)
	}
	for _, response := range []sdkResponse{{500, "42"}, {200, "bad"}, {200, "0"}} {
		if _, err := shipmentFrom(response); !errors.Is(err, ErrInvalidShipment) {
			t.Fatalf("response %+v: got %v", response, err)
		}
	}
}
```

정상 응답에서는 ID 42를 얻고, 비정상 상태와 잘못된 ID는 센티널 오류로 구분한다. `go test -v`로 확인한다.

### 사례 2 — 기존 저장소 연결

기존 저장소의 조회 메서드를 소비자의 `UserNames` 인터페이스에 연결한다.

```go
package pattern

import (
	"context"
	"errors"
	"testing"
)

var ErrUserMissing = errors.New("user missing")

type UserNames interface {
	Name(context.Context, int) (string, error)
}

type legacyDirectory map[int]string

func (d legacyDirectory) Lookup(id int) (string, bool) {
	name, ok := d[id]
	return name, ok
}

type directoryAdapter struct{ directory legacyDirectory }

func (a directoryAdapter) Name(ctx context.Context, id int) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	name, ok := a.directory.Lookup(id)
	if !ok {
		return "", ErrUserMissing
	}
	return name, nil
}

func greeting(ctx context.Context, users UserNames, id int) (string, error) {
	name, err := users.Name(ctx, id)
	if err != nil {
		return "", err
	}
	return "Hello " + name, nil
}

func TestLegacyDirectory(t *testing.T) {
	users := directoryAdapter{directory: legacyDirectory{7: "Mina"}}
	got, err := greeting(context.Background(), users, 7)
	if err != nil || got != "Hello Mina" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := greeting(context.Background(), users, 9); !errors.Is(err, ErrUserMissing) {
		t.Fatalf("missing user: got %v", err)
	}
}
```

소비자가 기존 저장소의 메서드명과 반환 형식에 의존하지 않고 인사말과 누락 오류를 얻는다. `go test -v`로 확인한다.

### 사례 3 — 취소와 센티널 오류 전달

문서 어댑터가 저장소 오류에 작업 이름을 덧붙인다. 호출자는 같은 context가 전달되고 오류의 원인을 구분할 수 있어야 한다.

```go
package pattern

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

var ErrMissing = errors.New("document missing")

type documentAdapter struct {
	fetch func(context.Context, string) ([]byte, error)
}

func (a documentAdapter) Read(ctx context.Context, key string) ([]byte, error) {
	data, err := a.fetch(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("read document: %w", err)
	}
	return data, nil
}

func TestAdapterPreservesCauses(t *testing.T) {
	for _, tc := range []struct {
		name     string
		canceled bool
		want     error
	}{
		{"missing", false, ErrMissing},
		{"canceled", true, context.Canceled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.canceled {
				cancel()
			}
			adapter := documentAdapter{fetch: func(received context.Context, _ string) ([]byte, error) {
				if received != ctx {
					t.Fatal("adapter replaced context")
				}
				if err := received.Err(); err != nil {
					return nil, err
				}
				return nil, ErrMissing
			}}
			_, err := adapter.Read(ctx, "report")
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want cause %v", err, tc.want)
			}
		})
	}
}
```

두 입력 모두 어댑터에서 감싼 오류를 반환하며, `errors.Is`로 취소와 문서 누락을 각각 확인할 수 있다. `go test -v`로 확인한다.

## 관련 문서

- [의존성 주입](dependency-injection.md)은 어댑터를 사용하는 서비스에 구현을 전달하는 방법을 설명한다.
- [Go context 패키지](https://pkg.go.dev/context)
- [Go errors 패키지](https://pkg.go.dev/errors)
