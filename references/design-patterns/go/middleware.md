# Middleware

## 목적

HTTP 요청을 처리하는 공통 동작을 핸들러 앞뒤에 배치한다. 각 단계는 다음 핸들러를 호출하거나 현재 단계에서 응답을 끝낸다.

## 사용처

여러 경로에 요청 기록, 인증, 요청 ID 같은 처리를 적용할 때 사용한다. 특정 경로만 사용하는 간단한 동작은 해당 핸들러에 둘 수 있다.

## 장단점

공통 동작을 조합하고 개별 단계의 동작을 시험할 수 있다. 등록 순서가 바뀌면 관찰하는 요청 정보와 조기 응답 범위도 달라진다.

## 구현 방식

`func(http.Handler) http.Handler` 형태로 다음 핸들러를 감싼다. 바깥쪽 래퍼가 먼저 실행된다. 요청 정보를 추가할 때 원래 context에서 파생해 취소를 보존하고, 조기 응답을 쓰면 즉시 반환한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 요청 소요 시간 기록

기존 요청 로그 예제를 확장해 다음 핸들러가 반환될 때 메서드와 소요 시간을 기록한다. 테스트에서는 두 시각을 주입한다.

```go
package pattern

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func requestLog(logger *log.Logger, now func() time.Time) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := now()
			defer func() {
				logger.Printf("method=%s elapsed=%s", r.Method, now().Sub(started))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func TestRequestLog(t *testing.T) {
	var logs bytes.Buffer
	start := time.Unix(0, 0)
	current := start
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	calls := 0
	handler := requestLog(log.New(&logs, "", 0), func() time.Time { return current })(
		http.HandlerFunc(func(w http.ResponseWriter, received *http.Request) {
			calls++
			if received != req {
				t.Fatal("received a different request")
			}
			current = start.Add(25 * time.Millisecond)
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte("queued"))
		}),
	)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if calls != 1 || res.Code != http.StatusAccepted || res.Body.String() != "queued" {
		t.Fatalf("calls %d, response %d %q", calls, res.Code, res.Body.String())
	}
	if got := logs.String(); got != "method=GET elapsed=25ms\n" {
		t.Fatalf("log: %q", got)
	}
}
```

다음 핸들러가 원래 요청을 한 번 받고 상태 202와 본문 `queued`를 보낸다. 로그에는 25ms가 기록된다. `go test -v`로 확인한다.

### 사례 2 — 인증과 요청 ID 조합

인증 결과와 관계없이 응답에 요청 ID를 표시할 수 있도록 요청 ID 단계를 바깥쪽에 배치한다. 인증 함수는 테스트 대역으로 주입한다.

```go
package pattern

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func withRequestID(newID func() string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", newID())
		next.ServeHTTP(w, r)
	})
}

func requireIdentity(verified func(*http.Request) bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !verified(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func TestRequestIDBeforeAuthentication(t *testing.T) {
	route := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	for verified, want := range map[bool]int{false: http.StatusUnauthorized, true: http.StatusNoContent} {
		auth := requireIdentity(func(*http.Request) bool { return verified }, route)
		handler := withRequestID(func() string { return "test-42" }, auth)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
		if res.Code != want || res.Header().Get("X-Request-ID") != "test-42" {
			t.Fatalf("verified %t: got %d, headers %v", verified, res.Code, res.Header())
		}
	}
}
```

인증을 거절해 401을 보내는 경우와 인증 후 204를 보내는 경우 모두 같은 테스트 요청 ID 헤더를 받는다. `go test -v`로 확인한다.

### 사례 3 — 조기 응답 이후 호출 차단

요청 context가 이미 취소되었으면 대역 응답 기록기에 408을 쓰고 다음 핸들러를 건너뛴다.

```go
package pattern

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func rejectCanceled(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Context().Err() != nil {
			http.Error(w, "request canceled", http.StatusRequestTimeout)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func TestCanceledRequestSkipsRoute(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	handler := rejectCanceled(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls++
	}))
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusRequestTimeout || calls != 0 {
		t.Fatalf("got %d, route calls %d", res.Code, calls)
	}
}
```

기록기에는 408이 남고 다음 핸들러의 호출 수는 0이다. 실제 연결에서는 취소로 이미 끊긴 클라이언트가 이 응답을 받지 못할 수 있다. `go test -v`로 확인한다.

## 관련 문서

- [Decorator](decorator.md)는 HTTP 이외 인터페이스에 같은 구성 방식을 적용한다.
- [Go의 HTTP 핸들러 문서](https://pkg.go.dev/net/http#Handler)
- [Go의 Request.Context 문서](https://pkg.go.dev/net/http#Request.Context)
