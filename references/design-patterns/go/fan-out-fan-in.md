# Fan-out / Fan-in

## 목적

독립적인 입력을 여러 작업자에게 나누고 결과를 소비자가 읽을 한 채널로 모은다. 작업 배분과 결과 수집은 조율 코드가 맡는다.

## 사용처

입력별 작업이 독립적이고 한 작업자가 모두 처리하는 시간이 병목일 때 사용한다. 입력이 작거나 순서대로 실행해야 하면 순차 반복문이 간단하다.

## 장단점

작업자가 여럿이면 CPU나 I/O 대기 시간을 겹쳐 처리할 수 있다. 고루틴과 채널에 비용이 들고, 결과 순서와 동시 작업 수, 첫 오류 이후 종료를 따로 설계해야 한다.

## 구현 방식

입력 생산자가 작업 채널을 닫고, 조율자가 모든 결과 송신자의 종료를 기다린 뒤 결과 채널을 닫는다. 소비자가 일찍 멈출 수 있으면 송신과 수신이 취소를 관찰하게 한다. 결과 순서가 계약의 일부라면 입력 위치를 결과에 담아 복원한다.

## 예시

각 사례는 별도 디렉터리에서 실행한다. Go 1.22 이상과 표준 라이브러리만 사용한다. 코드 블록을 각 디렉터리의 `pattern_test.go`로 저장한 뒤 `go mod init example.com/pattern`을 실행한다.

### 사례 1 — 작업 분배와 결과 수집

두 작업자가 하나의 입력 채널을 읽어 각 수의 제곱을 결과 채널로 보낸다. 소비자는 결과가 모두 올 때까지 읽는다.

```go
package pattern

import (
	"slices"
	"sync"
	"testing"
)

func squares(values []int) <-chan int {
	jobs := make(chan int)
	results := make(chan int)

	go func() {
		defer close(jobs)
		for _, value := range values {
			jobs <- value
		}
	}()

	var workers sync.WaitGroup
	workers.Add(2)
	for range 2 {
		go func() {
			defer workers.Done()
			for value := range jobs {
				results <- value * value
			}
		}()
	}
	go func() {
		workers.Wait()
		close(results)
	}()
	return results
}

func TestSquares(t *testing.T) {
	var got []int
	for result := range squares([]int{4, 1, 3, 2}) {
		got = append(got, result)
	}
	slices.Sort(got)
	if !slices.Equal(got, []int{1, 4, 9, 16}) {
		t.Fatalf("got %v", got)
	}
}
```

각 입력의 결과가 하나씩 도착한다. 입력 순서는 보장하지 않으므로 정렬한 뒤 비교한다. `go test -race -v -timeout 10s`로 확인한다.

### 사례 2 — 최대 동시 처리 수

작업자 두 명이 준비된 네 작업을 처리한다. 테스트는 첫 두 작업을 잠시 멈춰 두 작업이 실제로 동시에 실행됨을 확인한다.

```go
package pattern

import (
	"sync"
	"sync/atomic"
	"testing"
)

func collect(jobs []int, process func(int) int) []int {
	queue := make(chan int, len(jobs))
	for _, job := range jobs {
		queue <- job
	}
	close(queue)

	results := make(chan int)
	var workers sync.WaitGroup
	workers.Add(2)
	for range 2 {
		go func() {
			defer workers.Done()
			for job := range queue {
				results <- process(job)
			}
		}()
	}
	go func() {
		workers.Wait()
		close(results)
	}()

	var collected []int
	for result := range results {
		collected = append(collected, result)
	}
	return collected
}

func TestCollectWorkerLimit(t *testing.T) {
	var active atomic.Int32
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	done := make(chan []int, 1)
	go func() {
		done <- collect([]int{1, 2, 3, 4}, func(job int) int {
			if running := active.Add(1); running > 2 {
				t.Errorf("got %d active workers", running)
			}
			defer active.Add(-1)
			started <- struct{}{}
			<-release
			return job * 10
		})
	}()
	<-started
	<-started
	running := active.Load()
	close(release)
	collected := <-done
	var sum int
	for _, result := range collected {
		sum += result
	}
	if running != 2 || len(collected) != 4 || sum != 100 {
		t.Fatalf("got %d active workers, results %v", running, collected)
	}
}
```

실행 중인 작업 수가 두 개를 넘지 않고, 결과가 네 개이며 합계는 100이다. `go test -race -v -timeout 10s`로 확인한다.

### 사례 3 — 첫 오류 이후 취소와 송신 종료

작업 두 개를 각 작업자가 받은 상태에서 생산자가 세 번째 작업을 보내려 한다. 첫 작업이 실패하면 다른 작업과 입력 송신이 모두 취소되어야 한다.

```go
package pattern

import (
	"context"
	"errors"
	"sync"
	"testing"
)

var errProcessing = errors.New("processing failed")

func runWorkers(parent context.Context, values []int, process func(context.Context, int) error, beforeSend func(int)) error {
	ctx, cancel := context.WithCancelCause(parent)
	defer cancel(nil)
	jobs := make(chan int)

	var group sync.WaitGroup
	group.Add(3)
	go func() {
		defer group.Done()
		defer close(jobs)
		for _, value := range values {
			beforeSend(value)
			select {
			case jobs <- value:
			case <-ctx.Done():
				return
			}
		}
	}()
	for range 2 {
		go func() {
			defer group.Done()
			for value := range jobs {
				if err := process(ctx, value); err != nil {
					cancel(err)
					return
				}
			}
		}()
	}
	group.Wait()
	return context.Cause(ctx)
}

func TestSenderExitsAfterWorkerFailure(t *testing.T) {
	sendingThird := make(chan struct{})
	peerExited := make(chan struct{})
	err := runWorkers(context.Background(), []int{1, 2, 3}, func(ctx context.Context, value int) error {
		switch value {
		case 1:
			<-sendingThird
			return errProcessing
		case 2:
			defer close(peerExited)
			<-ctx.Done()
			return ctx.Err()
		default:
			t.Errorf("unexpected job %d started", value)
			return errors.New("unexpected job")
		}
	}, func(value int) {
		if value == 3 {
			close(sendingThird)
		}
	})
	if !errors.Is(err, errProcessing) {
		t.Fatalf("got %v", err)
	}
	select {
	case <-peerExited:
	default:
		t.Fatal("returned before canceled worker exited")
	}
}
```

`runWorkers`가 첫 오류를 반환한다. 함수가 생산자까지 포함한 `WaitGroup`을 기다리므로 시간 안에 반환했다는 사실이 입력 송신자도 종료했음을 보여 준다. `go test -race -v -timeout 10s`로 확인한다.

## 관련 문서

- [자원 정리](resource-cleanup.md)는 각 작업자가 소유한 자원의 종료 범위를 다룬다.
- [Go 블로그의 채널 파이프라인과 취소](https://go.dev/blog/pipelines)
- [Go의 WithCancelCause 문서](https://pkg.go.dev/context#WithCancelCause)
- [Go 경쟁 상태 탐지기와 지원 환경](https://go.dev/doc/articles/race_detector)
