# Observer

## 목적

값이나 이벤트를 생성하는 코드가 각 소비자를 직접 호출할 필요 없이 변경을 전달한다. 생산자는 알림 API를 제공하고, 소비자 또는 상위 소유자는 구독 시점과 해제 시점을 정한다.

## 사용처

같은 선택값을 여러 UI가 읽거나 센서처럼 연속으로 발생하는 이벤트를 소비할 때 도입한다. Flutter 프로젝트에서 이미 Bloc 또는 Riverpod 등으로 구독을 관리하면 그 경로를 우선 사용한다. 위젯 한 곳에서만 쓰는 상태는 `setState`로 충분하고, 결과가 한 번 도착하는 요청은 보통 `Future`로 표현한다.

## 장단점

- `ValueNotifier<T>`는 현재 값과 변경 알림을 함께 제공한다. 값에 기반한 작은 UI를 연결하기 쉽지만 `==`가 같은 값이나 가변 컬렉션 내부 변경은 새 알림을 만들지 않는다.
- `Stream<T>`은 여러 이벤트와 오류, 종료를 표현할 수 있다. 단일 구독과 브로드캐스트의 계약이 다르므로 구독 수, 구독 전 이벤트의 처리, 정지 시 리소스 비용을 확인한다.
- 생산자와 소비자의 호출 관계는 단순해지지만, 해제를 빼먹으면 화면을 닫은 뒤에도 이벤트가 전달될 수 있다. 구독을 늘릴 때는 중복 처리와 테스트에서 연결을 정리하는 비용도 고려한다.

## 구현 방식

현재 값 하나를 전달하는 Flutter 코드에서는 소유자가 `ValueNotifier`를 생성하고 해제한다. 수동으로 등록한 리스너는 같은 함수 참조로 제거한다. 여러 이벤트에는 `Stream`을 노출하고 `listen`을 호출한 쪽에서 반환된 `StreamSubscription`을 취소한다. 구독 해제 뒤 생산자 정리까지 기다려야 하면 `cancel()`의 반환값을 기다린다. `StreamController`의 종료는 컨트롤러를 만든 생산자가 책임진다.

## 예시

### 사례 1 — ValueNotifier로 단일 값 전달

수량 표시와 주문 요약이 현재 장바구니 수량을 공유한다. 표시 위젯은 초기값을 읽고 새 값이 전달되면 함께 갱신해야 한다. Dart 3.0 이상을 사용하는 Flutter 프로젝트에서 이 코드를 `test/observer_value_test.dart`에 저장하고 `flutter test test/observer_value_test.dart`를 실행한다.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('both displays follow the quantity', (tester) async {
    final quantity = ValueNotifier(1);
    addTearDown(quantity.dispose);

    Widget display(String label) => ValueListenableBuilder<int>(
          valueListenable: quantity,
          builder: (context, value, _) => Text('$label $value'),
        );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: Column(children: [display('수량'), display('요약')])),
    ));
    expect(find.text('수량 1'), findsOneWidget);
    expect(find.text('요약 1'), findsOneWidget);

    quantity.value = 2;
    await tester.pump();
    expect(find.text('수량 2'), findsOneWidget);
    expect(find.text('요약 2'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
```

테스트는 두 위젯에 초기값 1과 새 값 2가 순서대로 표시되는지 확인한다. `ValueListenableBuilder`가 위젯 수명에 맞춰 리스너 연결을 관리하며, 테스트가 생성한 알림 객체는 테스트 종료 시 해제한다.

### 사례 2 — Stream으로 연속 이벤트 받기

스캐너가 상품 코드를 발견하는 순서대로 전달한다. 구독자는 두 코드와 복구 가능한 오류를 구분해 처리하고, 생산자가 종료 신호를 보낸 뒤 결과를 확인한다. Dart 3.0 이상에서 코드를 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다.

```dart
import 'dart:async';

Future<void> main() async {
  final scanner = StreamController<String>();
  final codes = <String>[];
  final errors = <Object>[];
  final finished = Completer<void>();
  final subscription = scanner.stream.listen(
    codes.add,
    onError: (Object error) => errors.add(error),
    onDone: () => finished.complete(),
  );

  scanner.add('A-10');
  scanner.addError(const FormatException('Unrecognized code'));
  scanner.add('B-20');
  await scanner.close();
  await finished.future;
  await subscription.cancel();
  if (codes.join(',') != 'A-10,B-20' ||
      errors.length != 1 ||
      errors.single is! FormatException) {
    throw StateError('Unexpected scanner event sequence');
  }
}
```

프로그램은 코드가 순서대로 모이고 오류가 별도 콜백에 들어오면 정상 종료한다. `cancelOnError`를 `true`로 바꾸면 첫 오류에서 구독이 종료되어 후속 코드와 종료 콜백을 기다리는 계약도 함께 바꿔야 한다.

### 사례 3 — 가변 값 갱신과 리스너 해제

즐겨찾기 목록은 항목이 추가되는 시점에 한 번만 갱신을 알리고, 화면에서 제거된 리스너에는 이후 변경을 전달하지 않아야 한다. Dart 3.0 이상을 사용하는 Flutter 프로젝트에서 코드를 `test/observer_list_test.dart`에 저장하고 `flutter test test/observer_list_test.dart`를 실행한다.

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('replacing a list notifies until the listener is removed', () {
    final favorites = ValueNotifier<List<String>>(['home']);
    addTearDown(favorites.dispose);
    final observed = <List<String>>[];
    void listener() => observed.add(List.of(favorites.value));
    favorites.addListener(listener);

    favorites.value.add('office');
    expect(observed, isEmpty);

    favorites.value = List.unmodifiable([...favorites.value, 'gym']);
    expect(observed, [
      ['home', 'office', 'gym'],
    ]);

    favorites.removeListener(listener);
    favorites.value = List.unmodifiable([...favorites.value, 'park']);
    expect(observed, hasLength(1));
  });
}
```

테스트는 제자리 수정에는 알림이 없고 새 리스트를 대입할 때만 한 번 알리는지 확인한다. 실제 즐겨찾기 기능에서는 값을 처음부터 불변 리스트로 노출하고 추가할 때마다 새 리스트를 대입하면 제자리 수정으로 인한 누락을 막을 수 있다.

## 관련 문서

- [State](state.md)에서 알림으로 전달할 상태와 전이를 표현한다.
- [ViewModel](viewmodel.md)에서 화면과 구독의 수명에 맞춰 작업을 조율한다.
- [Flutter의 ValueNotifier 구현](https://github.com/flutter/flutter/blob/3.27.4/packages/flutter/lib/src/foundation/change_notifier.dart)
- [Dart의 StreamSubscription.cancel](https://api.dart.dev/dart-async/StreamSubscription/cancel.html)
