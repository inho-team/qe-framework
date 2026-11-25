# Functional Options

## 목적

공개 생성자에서 필수 인자와 선택 설정을 구분한다. 기본값과 최종 검증은 생성자가 맡고, 호출자는 변경할 설정을 함수로 전달한다.

## 사용처

선택 설정이 여러 개이고 호출마다 일부만 지정할 때 사용한다. 설정이 적거나 그대로 저장하고 읽어야 하면 설정 구조체로도 충분하다.

## 장단점

호출부에서 어떤 설정을 바꾸는지 옵션 이름으로 읽을 수 있다. 옵션이 많아지면 기본값, 중복 적용 순서, 상호 제약을 문서화하고 조합을 검증해야 한다.

## 구현 방식

생성자가 기본 설정을 만든 뒤 옵션을 전달받은 순서대로 적용한다. 같은 필드를 여러 번 설정할 수 있으면 마지막 값이 우선하는지 명시한다. 충돌이나 값 오류는 외부 자원을 열기 전에 검사한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 서버 설정

리스너를 열기 전에 필수 주소와 선택 읽기 제한을 적용한다.

```go
package pattern

import (
	"net/http"
	"testing"
	"time"
)

type ServerOption func(*http.Server)

func WithReadTimeout(timeout time.Duration) ServerOption {
	return func(s *http.Server) { s.ReadTimeout = timeout }
}

func NewServer(addr string, opts ...ServerOption) *http.Server {
	server := &http.Server{Addr: addr, ReadTimeout: 5 * time.Second}
	for _, apply := range opts {
		apply(server)
	}
	return server
}

func TestServerReadTimeout(t *testing.T) {
	server := NewServer("localhost:8080", WithReadTimeout(3*time.Second))
	if server.Addr != "localhost:8080" || server.ReadTimeout != 3*time.Second {
		t.Fatalf("got address %q, timeout %v", server.Addr, server.ReadTimeout)
	}
}
```

지정한 주소와 3초 제한이 설정에 반영된다. 테스트는 서버를 시작하지 않는다. `go test -v`로 확인한다.

### 사례 2 — 기본값과 여러 공개 옵션

지정하지 않은 필드에는 기본값을 쓴다. 같은 옵션이 반복되면 마지막 값으로 덮어쓴다.

```go
package pattern

import "testing"

type IndexConfig struct {
	BatchSize int
	Workers   int
	Compress  bool
}

type IndexOption func(*IndexConfig)

func WithBatchSize(size int) IndexOption {
	return func(cfg *IndexConfig) { cfg.BatchSize = size }
}

func WithCompression(enabled bool) IndexOption {
	return func(cfg *IndexConfig) { cfg.Compress = enabled }
}

func IndexDefaults(opts ...IndexOption) IndexConfig {
	cfg := IndexConfig{BatchSize: 100, Workers: 2}
	for _, apply := range opts {
		apply(&cfg)
	}
	return cfg
}

func TestIndexDefaults(t *testing.T) {
	defaults := IndexDefaults()
	if defaults != (IndexConfig{BatchSize: 100, Workers: 2}) {
		t.Fatalf("unexpected defaults: %+v", defaults)
	}
	cfg := IndexDefaults(WithBatchSize(50), WithCompression(true), WithBatchSize(25))
	want := IndexConfig{BatchSize: 25, Workers: 2, Compress: true}
	if cfg != want {
		t.Fatalf("got %+v, want %+v", cfg, want)
	}
}
```

배치 크기는 마지막으로 지정한 25가 되고, 작업자 수 2는 기본값으로 유지되며 압축이 켜진다. `go test -v`로 확인한다.

### 사례 3 — 충돌 옵션과 잘못된 값 거절

읽기 전용 보고서에는 백그라운드 갱신을 설정할 수 없다. 갱신 주기의 값과 구성의 호환성을 각각 검증한다.

```go
package pattern

import (
	"errors"
	"testing"
	"time"
)

var ErrInvalidInterval = errors.New("refresh interval must be positive")
var ErrReadOnlyRefresh = errors.New("read-only report cannot be refreshed")

type reportConfig struct {
	readOnly bool
	refresh  time.Duration
}

type ReportOption func(*reportConfig) error

func ReadOnly() ReportOption {
	return func(cfg *reportConfig) error {
		cfg.readOnly = true
		return nil
	}
}

func WithRefresh(interval time.Duration) ReportOption {
	return func(cfg *reportConfig) error {
		if interval <= 0 {
			return ErrInvalidInterval
		}
		cfg.refresh = interval
		return nil
	}
}

func reportSettings(opts ...ReportOption) (reportConfig, error) {
	var cfg reportConfig
	for _, apply := range opts {
		if err := apply(&cfg); err != nil {
			return reportConfig{}, err
		}
	}
	if cfg.readOnly && cfg.refresh != 0 {
		return reportConfig{}, ErrReadOnlyRefresh
	}
	return cfg, nil
}

func TestReportOptionValidation(t *testing.T) {
	for _, opts := range [][]ReportOption{
		{ReadOnly(), WithRefresh(time.Second)},
		{WithRefresh(time.Second), ReadOnly()},
	} {
		if _, err := reportSettings(opts...); !errors.Is(err, ErrReadOnlyRefresh) {
			t.Fatalf("conflicting options: got %v", err)
		}
	}
	if _, err := reportSettings(WithRefresh(0)); !errors.Is(err, ErrInvalidInterval) {
		t.Fatalf("invalid interval: got %v", err)
	}
}
```

옵션을 전달하는 순서와 관계없이 충돌을 거절하며, 0초 갱신 주기는 값 오류로 구분한다. `go test -v`로 확인한다.

## 관련 문서

- [의존성 주입](dependency-injection.md)은 생성자에 필수 구현을 전달하는 방법을 설명한다.
- [Go의 http.Server 필드 문서](https://pkg.go.dev/net/http#Server)
