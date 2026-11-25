# Factory

## 목적

객체를 생성하는 경계에서 외부 값을 검증하거나 설정에 맞는 구현을 선택한다. 호출부가 같은 검증을 반복하지 않아도 객체의 필수 조건을 보장할 수 있다.

## 사용처

JSON에서 주문 레코드를 만들 때 필수 필드와 값 범위를 검증하거나, 설정에 따라 다른 저장 구현을 만들 때 유용하다. 단순히 필드에 기본값을 제공한다면 이름 있는 인자로 충분하고, 필드 초기화만 여러 형태로 제공한다면 이름을 붙인 일반 생성자를 쓸 수 있다.

## 장단점

- `fromJson` 같은 이름이 생성에 필요한 입력을 명확히 하고, 비공개 생성자와 함께 사용하면 외부 라이브러리에서 검증된 경로로만 인스턴스를 만들 수 있다.
- `factory`는 기존 인스턴스나 하위 타입을 반환할 수 있다. 동일 인스턴스를 재사용하면 변경 가능한 객체의 상태와 리소스 수명이 호출자 사이에서 공유될 수 있다.
- 잘못된 입력을 일찍 거절할 수 있지만, 지원하지 않는 키까지 거절할 경우 외부 서비스가 필드를 추가했을 때도 조정이 필요하다. 설정 파일과 외부 응답에 필요한 엄격성은 각각 정한다.

## 구현 방식

검증 후 값을 할당하는 비공개 생성자와 외부 입력을 확인하는 이름 있는 `factory`를 구분한다. 구현 선택에 필요한 설정은 생성 시점에 검증한다. `factory` 생성자는 비동기로 실행할 수 없으므로 파일이나 네트워크에서 먼저 읽어야 하는 설정이 있다면 `Future<T>`를 반환하는 별도 함수에서 읽은 뒤 생성한다. 호출자에게 전달할 오류 종류와 필드 정보를 정한다.

## 예시

Dart 3.0 이상에서 각 코드를 독립적으로 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다.

### 사례 1 — JSON 값으로 유효한 주문 레코드 생성

주문 항목은 공백을 제거한 SKU와 양의 수량을 가져야 한다. JSON을 받은 코드는 이름 있는 생성 경계를 통과한 항목으로 주문서를 구성한다.

```dart
import 'dart:convert';

final class OrderLine {
  const OrderLine._(this.sku, this.quantity);

  final String sku;
  final int quantity;

  factory OrderLine.fromJson(Object? data) {
    if (data case {'sku': String sku, 'quantity': int quantity}
        when sku.trim().isNotEmpty && quantity > 0) {
      return OrderLine._(sku.trim(), quantity);
    }
    throw const FormatException('Expected SKU and a positive quantity');
  }
}

void main() {
  final line = OrderLine.fromJson(jsonDecode('{"sku":" T-4 ","quantity":2}'));
  if (line.sku != 'T-4' || line.quantity != 2) {
    throw StateError('Unexpected order line');
  }
  try {
    OrderLine.fromJson(jsonDecode('{"sku":"T-4","quantity":0}'));
    throw StateError('Expected zero quantity to fail');
  } on FormatException {
    // The factory enforces the quantity invariant.
  }
}
```

유효한 JSON으로 SKU `T-4`와 수량 2를 읽고, 수량 0은 객체 생성 전에 거절하는지 확인한다.

### 사례 2 — 설정에 따라 출력 구현 선택

감사 로그는 개발 환경에서 메모리에 기록하고, 기록을 비활성화한 환경에서는 출력을 버린다. 호출부는 같은 계약으로 메시지를 전달하고, 환경 설정에서 지원하지 않는 값은 시작 시 거절한다.

```dart
abstract class AuditSink {
  AuditSink._();

  factory AuditSink.fromSettings(String mode, List<String> messages) {
    return switch (mode) {
      'memory' => MemoryAuditSink(messages),
      'disabled' => DisabledAuditSink(),
      _ => throw ArgumentError.value(mode, 'mode', 'Unsupported audit mode'),
    };
  }

  void write(String message);
}

class MemoryAuditSink extends AuditSink {
  MemoryAuditSink(this._messages) : super._();
  final List<String> _messages;

  @override
  void write(String message) => _messages.add(message);
}

class DisabledAuditSink extends AuditSink {
  DisabledAuditSink() : super._();

  @override
  void write(String message) {}
}

void main() {
  final entries = <String>[];
  AuditSink.fromSettings('memory', entries).write('order saved');
  AuditSink.fromSettings('disabled', entries).write('ignored');
  if (entries.length != 1 || entries.single != 'order saved') {
    throw StateError('Unexpected audit sink');
  }
}
```

두 구현을 같은 메서드로 호출한 뒤 메모리 모드의 메시지만 남으면 정상 종료한다. 입력 모드를 `unknown`으로 바꾸면 로그를 쓰기 전에 `ArgumentError`가 발생한다. 이 예시에서는 호출자가 메모리 목록을 소유하므로 생성된 기록기는 목록을 정리하지 않는다.

### 사례 3 — 지원하지 않는 키와 필드 타입 거절

작업자 설정은 재시도 횟수 `attempts`만 받는다. 지원하지 않는 옵션, 필드 누락, 잘못된 자료형을 구분하면 설정을 고치는 사람이 문제를 바로 찾을 수 있다.

```dart
final class RetrySettings {
  const RetrySettings._(this.attempts);
  final int attempts;

  factory RetrySettings.fromMap(Map<String, Object?> data) {
    for (final key in data.keys) {
      if (key != 'attempts') throw FormatException('Unknown key: $key');
    }
    if (!data.containsKey('attempts')) {
      throw const FormatException('Missing attempts');
    }
    final attempts = data['attempts'];
    if (attempts is! int || attempts < 0) {
      throw const FormatException('Expected a nonnegative integer for attempts');
    }
    return RetrySettings._(attempts);
  }
}

void expectBadSettings(Map<String, Object?> input, String message) {
  try {
    RetrySettings.fromMap(input);
    throw StateError('Expected invalid settings');
  } on FormatException catch (error) {
    if (error.message != message) rethrow;
  }
}

void main() {
  if (RetrySettings.fromMap({'attempts': 0}).attempts != 0) {
    throw StateError('Zero must disable retry');
  }
  expectBadSettings({'attempts': 2, 'backoff': 500}, 'Unknown key: backoff');
  expectBadSettings({}, 'Missing attempts');
  expectBadSettings(
    {'attempts': '2'},
    'Expected a nonnegative integer for attempts',
  );
}
```

재시도 0은 유효하며, 알 수 없는 키, 누락, 문자열 수량은 각각의 오류 메시지로 거절되면 정상 종료한다. 외부 응답의 추가 필드를 허용해야 하는 경우에는 사례 1처럼 필수 필드만 매칭한다.

## 관련 문서

- [Adapter](adapter.md)에서 외부 계약 전반을 앱의 자료형과 오류로 변환한다.
- [Strategy](strategy.md)에서 설정으로 선택한 정책을 실행 흐름에 주입한다.
- [Dart의 생성자](https://dart.dev/language/constructors)
