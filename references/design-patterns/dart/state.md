# State

## 목적

로딩, 성공, 실패에서 읽을 수 있는 값과 허용되는 전이를 명시한다. 상태를 타입으로 표현하면 호출자는 현재 상태에 맞는 필드만 읽고, 요청을 소유한 객체는 언제 다음 상태를 게시할지 결정한다.

## 사용처

조회가 끝난 뒤에만 데이터가 있거나 오류가 발생한 경우에만 재시도할 수 있다면 상태별 타입이 유용하다. 여러 비동기 요청이 같은 UI에 결과를 게시할 때는 중복 요청과 응답 순서도 전이 규칙에 포함한다. 한 번 토글하는 표시처럼 가능한 값과 갱신 순서가 단순하면 `bool`이나 `enum`으로 충분하다.

## 장단점

- `sealed` 타입과 빠짐없이 분기하는 `switch`를 사용하면 상태 추가 뒤 처리해야 할 곳을 분석기로 찾을 수 있다. 서로 모순되는 플래그 조합도 줄어든다.
- 상태마다 타입이나 생성자가 필요하고, 재시도와 취소처럼 전이 조건이 늘면 테스트할 조합도 늘어난다. 오류 메시지와 이전 값처럼 화면에 필요한 정보부터 모델링한다.
- 타입을 선언해도 비동기 응답 순서와 수명은 코드에서 다뤄야 한다. 이전 요청의 결과 게시를 막아도 그 요청의 네트워크 작업은 완료까지 진행될 수 있다.

## 구현 방식

Dart 3의 `sealed` 상태와 직접 하위 타입을 같은 라이브러리에 선언한다. 요청 소유자는 시작 시 로딩 상태를 게시하고 성공과 예상된 실패가 어떤 상태로 이어질지 정한다. 최신 요청을 구분하는 번호와 해제 여부를 상태 게시 전에 확인한다. Flutter 위젯이 상태를 직접 소유한다면 `await` 이후 `setState` 전에 `mounted`와 요청 번호를 확인한다. 가능하면 `dispose` 시 작업이나 구독을 해제한다.

## 예시

Dart 3.0 이상에서 각 코드를 독립적으로 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다. 외부 패키지는 사용하지 않는다.

### 사례 1 — sealed 타입으로 로딩과 성공 표현

배송 추적 화면은 조회 중에는 진행 문구를, 완료 후에는 배송 번호를 표시해야 한다. 배송 번호는 성공 상태에서만 존재한다.

```dart
sealed class TrackingState {
  const TrackingState();
}

final class TrackingLoading extends TrackingState {
  const TrackingLoading();
}

final class TrackingReady extends TrackingState {
  const TrackingReady(this.trackingNumber);
  final String trackingNumber;
}

String heading(TrackingState state) => switch (state) {
      TrackingLoading() => '조회 중',
      TrackingReady(:final trackingNumber) => '배송 번호: $trackingNumber',
    };

void main() {
  if (heading(const TrackingLoading()) != '조회 중' ||
      heading(const TrackingReady('P-42')) != '배송 번호: P-42') {
    throw StateError('Unexpected tracking label');
  }
}
```

프로그램은 두 상태가 각자의 문구를 표시하면 정상 종료한다. 같은 라이브러리에 `TrackingFailed` 하위 타입을 추가한 뒤 분석을 다시 실행하면 `switch`에 누락된 분기가 표시된다.

### 사례 2 — 입력 제출 뒤 성공과 실패의 전이

이메일 주소를 저장하는 화면은 요청 중에는 제출을 한 번만 받고, 저장 결과에 따라 완료 또는 오류를 표시해야 한다. 이 예시에서는 서버가 주소를 거절하는 경우를 `FormatException`으로 표현한다.

```dart
import 'dart:async';

enum Submission { idle, saving, saved, rejected }

class EmailForm {
  EmailForm(this._save);
  final Future<void> Function(String) _save;

  Submission state = Submission.idle;

  Future<void> submit(String address) async {
    if (state == Submission.saving) return;
    state = Submission.saving;
    try {
      await _save(address);
      state = Submission.saved;
    } on FormatException {
      state = Submission.rejected;
    } finally {
      if (state == Submission.saving) state = Submission.idle;
    }
  }
}

Future<void> main() async {
  final pending = Completer<void>();
  var calls = 0;
  final form = EmailForm((address) async {
    calls++;
    if (!address.contains('@')) throw const FormatException('Email expected');
    await pending.future;
  });

  final submitting = form.submit('ara@example.test');
  await form.submit('duplicate@example.test');
  if (form.state != Submission.saving || calls != 1) {
    throw StateError('Expected one pending submission');
  }
  pending.complete();
  await submitting;
  if (form.state != Submission.saved) throw StateError('Expected saved');

  await form.submit('invalid');
  if (form.state != Submission.rejected) throw StateError('Expected rejected');
}
```

`Completer`로 성공 시점을 제어해 대기 상태와 중복 제출 무시를 관찰한 뒤, 올바른 입력은 `saved`로, 거절된 입력은 `rejected`로 전이하는지 확인한다. 예상 밖의 예외는 호출자에게 전달하고 상태를 `idle`로 복구하므로 다음 제출을 시작할 수 있다.

### 사례 3 — 늦은 응답과 해제 뒤 상태 게시 차단

사용자가 문서를 빠르게 바꾸면 먼저 시작한 조회가 나중에 완료될 수 있다. 최근에 선택한 문서만 표시하고, 화면을 해제한 뒤에는 완료된 응답을 게시하지 않는다.

```dart
import 'dart:async';

class DocumentSelection {
  DocumentSelection(this._fetch, this._publish);
  final Future<String> Function(String) _fetch;
  final void Function(String) _publish;

  int _request = 0;
  bool _disposed = false;

  Future<void> select(String id) async {
    if (_disposed) return;
    final request = ++_request;
    final String message;
    try {
      message = await _fetch(id);
    } on FormatException {
      if (!_disposed && request == _request) _publish('문서를 읽을 수 없음');
      return;
    }
    if (!_disposed && request == _request) _publish(message);
  }

  void dispose() => _disposed = true;
}

Future<void> main() async {
  final requests = {
    'old': Completer<String>(),
    'new': Completer<String>(),
    'closing': Completer<String>(),
  };
  final published = <String>[];
  final selection = DocumentSelection(
    (id) => requests[id]!.future,
    published.add,
  );

  final old = selection.select('old');
  final latest = selection.select('new');
  requests['new']!.complete('current');
  await latest;
  requests['old']!.complete('outdated');
  await old;

  final closing = selection.select('closing');
  selection.dispose();
  requests['closing']!.completeError(const FormatException('bad document'));
  await closing;
  if (published.length != 1 || published.single != 'current') {
    throw StateError('Only the latest active request may publish');
  }
}
```

최신 성공을 먼저 완료하고 이전 성공과 해제 뒤 실패를 차례로 완료한다. 게시 목록에 `current` 한 건만 남아야 정상 종료한다.

## 관련 문서

- [Observer](observer.md)에서 상태 변경을 전달하는 구독과 해제를 다룬다.
- [ViewModel](viewmodel.md)에서 화면 상태 전이와 사용자 명령을 조율한다.
- [Dart의 sealed 클래스](https://dart.dev/language/class-modifiers#sealed)
