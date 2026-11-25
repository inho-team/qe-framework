# ViewModel

## 목적

화면에 표시할 상태와 화면에서 호출할 명령을 한곳에서 조율한다. 화면은 상태를 렌더링하고 사용자의 입력을 명령으로 전달하며, ViewModel은 저장소 호출과 결과 처리 순서를 관리한다.

## 사용처

화면에 조회 중, 빈 결과, 재시도 상태가 있거나 여러 화면에서 같은 긴 작업의 진행률과 취소 명령을 공유할 때 유용하다. 한 위젯을 펼치거나 닫는 정도의 상태는 해당 위젯에서 관리해도 충분하다. Bloc이나 Riverpod을 사용하는 앱에서는 현재 구조가 맡는 상태, 명령, 주입, 해제 책임에 맞춰 구성한다.

## 장단점

- 저장소를 생성자로 받으면 UI 없이도 명령과 상태의 순서를 검증할 수 있다. 여러 뷰가 같은 모델을 구독해 작업 상태의 일관성을 유지할 수 있다.
- 화면의 명령을 한곳에 모으면 여러 화면이 함께 바뀌는 작업에 유용하다. UI의 임시 값과 저장소의 캐시 정책까지 모두 넣으면 모델이 커지고 변경 이유가 뒤섞인다.
- 공유 범위가 넓을수록 마지막 화면이 사라지는 시점과 작업의 종료 시점이 달라질 수 있다. 공유 소유자와 해제 책임을 정해야 중복 요청과 제거된 화면의 후속 알림을 막을 수 있다.

## 구현 방식

저장소와 작업 공급자를 생성자로 받고, 화면에 필요한 결과와 명령만 공개한다. 화면은 상태를 읽고 명령을 전달한다. 화면을 넘어 작업을 공유할 경우 두 화면보다 오래 사는 조립 지점이 모델을 소유하고, 구독은 각 화면의 수명에 맞춰 연결한다. 중복 명령을 무시할지 기존 `Future`를 공유할지 정한다. 취소를 지원하는 API에는 취소를 요청하고, 취소를 지원하지 않는 `Future`는 해제 이후 결과 게시를 차단한다.

## 예시

### 사례 1 — 화면의 조회 상태와 명령 조율

최근 주문 화면은 조회 중 진행 표시를 보여 주고, 완료되면 주문 목록이나 빈 결과를 표시한다. 저장소의 조회 결과를 화면에 표시할 상태로 매핑한다. Dart 3.0 이상에서 코드를 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다.

```dart
abstract interface class OrderRepository {
  Future<List<String>> recentOrderIds();
}

class LocalOrders implements OrderRepository {
  LocalOrders(this._ids);
  final List<String> _ids;

  @override
  Future<List<String>> recentOrderIds() async => List.of(_ids);
}

enum OrdersPhase { loading, empty, ready }

typedef OrdersState = ({OrdersPhase phase, List<String> ids});

class RecentOrders {
  RecentOrders(this._orders, this._publish);
  final OrderRepository _orders;
  final void Function(OrdersState) _publish;

  Future<void> load() async {
    _publish((phase: OrdersPhase.loading, ids: const []));
    final ids = List<String>.unmodifiable(await _orders.recentOrderIds());
    _publish((phase: ids.isEmpty ? OrdersPhase.empty : OrdersPhase.ready, ids: ids));
  }
}

Future<void> main() async {
  final states = <OrdersState>[];
  await RecentOrders(LocalOrders(['O-42']), states.add).load();
  await RecentOrders(LocalOrders([]), states.add).load();
  if (states.map((state) => state.phase).join(',') !=
          [
            OrdersPhase.loading,
            OrdersPhase.ready,
            OrdersPhase.loading,
            OrdersPhase.empty,
          ].join(',') ||
      states[1].ids.single != 'O-42' ||
      states.last.ids.isNotEmpty) {
    throw StateError('Unexpected view state sequence');
  }
}
```

조회 중 상태가 먼저 게시되고 저장소 데이터의 유무에 따라 `ready` 또는 `empty`가 뒤따르면 정상 종료한다. 이 예시는 정상 조회와 빈 목록을 다룬다. 실패 뒤 화면 상태를 바꾸는 기능을 구현할 때는 예상한 저장소 오류를 재시도 가능한 상태로 표현한다.

### 사례 2 — 두 화면에서 공유하는 긴 작업 취소

내보내기 화면에서 작업을 시작하고 관리 화면으로 이동한 뒤에도 같은 작업을 취소할 수 있어야 한다. 두 화면 밖의 소유자가 ViewModel을 한 번만 만들고, 작업 대역은 구독이 취소될 때 정리됐음을 알린다.

Dart 3.0 이상을 사용하는 Flutter 프로젝트에서 `flutter_test`를 개발 의존성으로 추가한다. 코드를 `test/export_test.dart`에 저장하고 `flutter test test/export_test.dart`를 실행한다.

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class ExportViewModel {
  ExportViewModel(this._startExport);
  final Stream<int> Function() _startExport;
  final status = ValueNotifier('대기');
  StreamSubscription<int>? _job;

  void start() {
    if (_job != null) return;
    status.value = '내보내는 중';
    _job = _startExport().listen(
      (percent) => status.value = '$percent%',
      onError: (Object error) {
        _job = null;
        status.value = '내보내기 실패';
      },
      onDone: () {
        _job = null;
        status.value = '완료';
      },
      cancelOnError: true,
    );
  }

  Future<void> cancel() async {
    final job = _job;
    if (job == null) return;
    _job = null;
    status.value = '취소됨';
    await job.cancel();
  }

  Future<void> dispose() async {
    try {
      await _job?.cancel();
    } finally {
      status.dispose();
    }
  }
}

class ExportProgress extends StatelessWidget {
  const ExportProgress(this.model, {super.key});
  final ExportViewModel model;

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Column(children: [
      ValueListenableBuilder<String>(
        valueListenable: model.status,
        builder: (context, status, _) => Text(status),
      ),
      ElevatedButton(onPressed: model.start, child: const Text('시작')),
      ElevatedButton(
        onPressed: () => Navigator.of(context).push<void>(
          MaterialPageRoute(builder: (_) => ExportControls(model)),
        ),
        child: const Text('작업 관리'),
      ),
    ]));
  }
}

class ExportControls extends StatelessWidget {
  const ExportControls(this.model, {super.key});
  final ExportViewModel model;

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: Column(children: [
      ElevatedButton(onPressed: model.cancel, child: const Text('취소')),
      ElevatedButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('돌아가기'),
      ),
    ]));
  }
}

void main() {
  testWidgets('cancel in controls updates the progress screen', (tester) async {
    var releaseCount = 0;
    final worker = StreamController<int>(onCancel: () => releaseCount++);
    final model = ExportViewModel(() => worker.stream);
    addTearDown(worker.close);
    addTearDown(model.dispose);

    await tester.pumpWidget(MaterialApp(home: ExportProgress(model)));
    await tester.tap(find.text('시작'));
    worker.add(40);
    await tester.pumpAndSettle();
    expect(find.text('40%'), findsOneWidget);

    await tester.tap(find.text('작업 관리'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(releaseCount, 1);
    await tester.tap(find.text('돌아가기'));
    await tester.pumpAndSettle();
    expect(find.text('취소됨'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
```

내보내기 화면에 40%가 표시되고, 관리 화면에서 취소하면 작업의 정리가 한 번 호출되며, 원래 화면에 돌아가면 `취소됨`이 표시되는지 확인한다. 예시는 구독 한 번을 허용하는 작업 대역을 쓴다. 실제 공급자는 재시작마다 새 작업을 만들고 `onCancel`에서 작업 자체의 리소스를 정리해야 한다.

### 사례 3 — 중복 요청과 화면 해제 뒤 상태 정리

사용자가 알림 목록의 새로 고침을 연속으로 누르면 기존 요청을 공유한다. 화면을 닫은 뒤 결과가 도착하면 알림을 게시하지 않고, 진행 중이던 요청 참조를 정리한다. Dart 3.0 이상에서 코드를 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다.

```dart
import 'dart:async';

class InboxViewModel {
  InboxViewModel(this._fetch, this._showUnreadCount);
  final Future<int> Function() _fetch;
  final void Function(int) _showUnreadCount;

  Future<void>? _inFlight;
  bool _disposed = false;

  bool get refreshing => _inFlight != null;

  Future<void> refresh() {
    if (_disposed) return Future.value();
    return _inFlight ??= Future.sync(_fetch).then((count) {
      if (!_disposed) _showUnreadCount(count);
    }).whenComplete(() => _inFlight = null);
  }

  void dispose() {
    _disposed = true;
    _inFlight = null;
  }
}

Future<void> main() async {
  final pending = Completer<int>();
  var remoteCalls = 0;
  final displayed = <int>[];
  final model = InboxViewModel(() {
    remoteCalls++;
    return pending.future;
  }, displayed.add);

  final first = model.refresh();
  if (!identical(first, model.refresh()) ||
      !model.refreshing ||
      remoteCalls != 1) {
    throw StateError('Expected one request shared by both callers');
  }

  model.dispose();
  if (model.refreshing) throw StateError('Disposed state should be clear');
  pending.complete(3);
  await first;
  await model.refresh();
  if (displayed.isNotEmpty || model.refreshing || remoteCalls != 1) {
    throw StateError('A disposed model must stop updating the view');
  }
}
```

두 호출이 동일한 `Future`를 공유하며 요청이 한 번만 시작되는지 먼저 확인한다. 모델을 해제하고 요청을 완료했을 때 새 표시나 추가 요청이 없으면 정상 종료한다. 저장소가 실패하면 같은 `Future`를 기다리는 호출자에게 오류가 전달되고 `whenComplete`에서 요청 참조가 정리된다.

## 관련 문서

- [State](state.md)에서 유효한 화면 상태와 전이를 정의한다.
- [Observer](observer.md)에서 상태 알림과 구독 해제를 다룬다.
- [Repository](repository.md)에서 화면과 독립적인 데이터 접근 계약을 정의한다.
- [Flutter 앱 아키텍처의 ViewModel](https://docs.flutter.dev/app-architecture/guide#view-models)
