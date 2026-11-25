# 자원 정리

## 목적

파일, 잠금, HTTP 응답 본문을 반환 경로마다 정리한다. 자원을 획득한 함수에서 정리 시점과 책임을 확인할 수 있게 한다.

## 사용처

자원 수명이 함수 한 번의 실행에 맞을 때 `defer`를 사용한다. 더 오래 유지해야 하는 자원은 소유권을 넘기고 종료를 맡을 호출자를 명시한다.

## 장단점

정상 반환과 중간 오류에 같은 정리 코드가 실행된다. `defer`는 함수를 빠져나갈 때까지 실행되지 않으므로 긴 루프에서는 자원이 쌓일 수 있다. 닫기 오류의 처리 방식도 정해야 한다.

## 구현 방식

자원 획득에 성공한 직후 정리를 등록한다. 여러 `defer`는 등록 역순으로 실행되므로 획득과 종료 순서를 함께 읽는다. 항목별로 닫아야 하는 반복문은 각 항목을 별도 함수로 처리한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 응답 본문 닫기

HTTP 클라이언트가 반환한 본문을 읽고 닫는다. 테스트는 읽기 오류를 내는 본문 대역을 주입한다.

```go
package pattern

import (
	"errors"
	"io"
	"net/http"
	"testing"
)

func readBody(get func(string) (*http.Response, error), url string) ([]byte, error) {
	resp, err := get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

var errRead = errors.New("body read failed")

type failingBody struct{ closed bool }

func (*failingBody) Read([]byte) (int, error) { return 0, errRead }

func (b *failingBody) Close() error {
	b.closed = true
	return nil
}

func TestResponseBodyClosedOnReadError(t *testing.T) {
	body := &failingBody{}
	get := func(string) (*http.Response, error) {
		return &http.Response{Body: body}, nil
	}
	_, err := readBody(get, "https://example.invalid")
	if !errors.Is(err, errRead) || !body.closed {
		t.Fatalf("got %v, closed %t", err, body.closed)
	}
}
```

네트워크 없이 읽기 오류를 재현하고 본문이 닫혔는지 확인한다. 이 예시는 읽기 오류만 반환하며 닫기 오류도 중요한 자원은 별도로 처리할 수 있다. `go test -v`로 확인한다.

### 사례 2 — 잠금과 파일 정리 순서

잠금을 잡은 구간 안에서만 파일을 사용한다. 파일을 닫은 뒤 잠금을 풀며, 쓰기와 닫기 오류를 모두 반환한다.

```go
package pattern

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
)

type writableFile interface {
	Write([]byte) (int, error)
	Close() error
}

func writeLocked(mu sync.Locker, open func() (writableFile, error), data []byte) (err error) {
	mu.Lock()
	defer mu.Unlock()

	file, err := open()
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	_, err = file.Write(data)
	return err
}

type trackedLock struct {
	sync.Mutex
	events *[]string
}

func (l *trackedLock) Unlock() {
	*l.events = append(*l.events, "unlock")
	l.Mutex.Unlock()
}

type trackedFile struct {
	*os.File
	events *[]string
}

func (f trackedFile) Close() error {
	*f.events = append(*f.events, "close")
	return f.File.Close()
}

func TestFileClosedBeforeUnlock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "message")
	var events []string
	mu := &trackedLock{events: &events}
	open := func() (writableFile, error) {
		file, err := os.Create(path)
		if err != nil {
			return nil, err
		}
		return trackedFile{File: file, events: &events}, nil
	}
	if err := writeLocked(mu, open, []byte("ok")); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(events, []string{"close", "unlock"}) {
		t.Fatalf("cleanup order: %v", events)
	}
}
```

임시 파일의 닫기 동작이 잠금 해제보다 먼저 기록된다. `go test -v`로 확인한다.

### 사례 3 — 긴 루프에서 항목별 자원 해제

각 항목을 별도 함수에서 읽고 닫는다. 테스트 대역으로 반복문이 끝나기 전에도 이전 항목이 닫혔는지 확인한다.

```go
package pattern

import (
	"io"
	"strings"
	"testing"
)

func importAll(names []string, open func(string) (io.ReadCloser, error)) error {
	for _, name := range names {
		if err := importOne(name, open); err != nil {
			return err
		}
	}
	return nil
}

func importOne(name string, open func(string) (io.ReadCloser, error)) error {
	item, err := open(name)
	if err != nil {
		return err
	}
	defer item.Close()
	_, err = io.Copy(io.Discard, item)
	return err
}

type itemReader struct {
	io.Reader
	openCount *int
}

func (r itemReader) Close() error {
	*r.openCount = *r.openCount - 1
	return nil
}

func TestAtMostOneOpenItem(t *testing.T) {
	openCount := 0
	open := func(name string) (io.ReadCloser, error) {
		if openCount != 0 {
			t.Fatalf("opening %q with %d items still open", name, openCount)
		}
		openCount++
		return itemReader{Reader: strings.NewReader(name), openCount: &openCount}, nil
	}
	if err := importAll([]string{"first", "second", "third"}, open); err != nil {
		t.Fatal(err)
	}
	if openCount != 0 {
		t.Fatalf("%d items still open", openCount)
	}
}
```

동시에 열린 항목은 최대 하나이며 반복문이 끝나면 열린 항목 수가 0이다. `go test -v`로 확인한다.

## 관련 문서

- [의존성 주입](dependency-injection.md)은 자원을 여러 서비스가 공유할 때 누가 닫는지 정한다.
- [Go 명세의 defer 설명](https://go.dev/ref/spec#Defer_statements)
- [Go의 http.Response.Body 문서](https://pkg.go.dev/net/http#Response)
