# Adapter

## 목적

플랫폼, 서비스, 라이브러리가 사용하는 자료형과 오류를 앱의 계약에 맞게 변환한다. 호출부는 외부 키 이름, DTO, 플랫폼 코드에 의존하지 않고 도메인 값으로 동작한다.

## 사용처

플랫폼별 어댑터가 같은 기기 정보를 제공해야 하거나 외부 JSON의 키와 앱의 도메인 모델이 다르면 도입한다. 형식이 한 번만 바뀌는 단순한 변환은 함수로 충분할 수 있다. 원격과 로컬 중 조회 경로를 선택하거나 캐시를 관리하는 기능은 Repository와 함께 구성할 수 있다.

## 장단점

- 외부 사양 변경에 따른 수정 범위가 줄고, 네이티브 런타임이나 네트워크 없이 변환 규칙을 테스트할 수 있다.
- 서로 다른 외부 오류를 같은 앱 오류로 묶으면 진단에 필요한 차이가 사라질 수 있다. 오류 종류와 원본 예외를 얼마나 보존할지 정한다.
- 입력 정규화에는 비용이 든다. 큰 목록은 변환 결과를 복사해 메모리를 더 쓸 수 있고, 불필요하게 같은 변환을 여러 계층에 반복하기 쉽다.

## 구현 방식

어댑터가 외부 호출을 받고 런타임 자료형, 필수 필드, 지원 범위를 확인한 뒤 도메인 값을 반환한다. 외부 라이브러리의 전송 실패와 형식 오류를 구분하고, 원래 실패 원인을 보존할 필요가 있으면 앱 오류에 포함한다. 선택값 부재, 호출 미지원, 손상된 값의 의미를 정한 뒤 `null`, 별도 상태, 예외를 배정한다. 플랫폼 함수를 대역으로 테스트하고 지원 플랫폼별 반환 규약은 통합 테스트로 확인한다.

## 예시

Dart 3.0 이상에서 각 코드를 독립적으로 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다. 플랫폼 함수와 원격 전송에는 대역을 쓴다.

### 사례 1 — 플랫폼 API 반환값을 앱 타입으로 변환

배터리 기능은 플랫폼 호출에서 정수 퍼센트가 오면 읽을 수 있는 상태로, 등록된 미지원 센티널 `-1`을 받으면 정보 없음으로 표현한다. 타입이 다르거나 범위를 벗어나는 값은 형식 오류다.

```dart
sealed class BatteryStatus {
  const BatteryStatus();
}

final class BatteryLevel extends BatteryStatus {
  const BatteryLevel(this.percent);
  final int percent;
}

final class BatteryUnavailable extends BatteryStatus {
  const BatteryUnavailable();
}

class BatteryAdapter {
  BatteryAdapter(this._readPlatform);
  final Future<Object?> Function() _readPlatform;

  Future<BatteryStatus> read() async {
    final raw = await _readPlatform();
    return switch (raw) {
      int percent when percent == -1 => const BatteryUnavailable(),
      int percent when percent >= 0 && percent <= 100 => BatteryLevel(percent),
      _ => throw const FormatException('Invalid battery level'),
    };
  }
}

Future<void> main() async {
  Object? platformValue = 68;
  final battery = BatteryAdapter(() async => platformValue);
  final status = await battery.read();
  if (status is! BatteryLevel || status.percent != 68) {
    throw StateError('Expected 68 percent');
  }
  platformValue = -1;
  if (await battery.read() is! BatteryUnavailable) {
    throw StateError('Expected the unsupported state');
  }
  platformValue = -1.0;
  try {
    await battery.read();
    throw StateError('A double must not match the integer sentinel');
  } on FormatException {
    // The platform contract requires an integer.
  }
}
```

플랫폼 대역의 `68`과 `-1`이 서로 다른 앱 상태로 변환되고, 정수가 아닌 `-1.0`은 형식 오류로 거절되면 정상 종료한다. Flutter 앱에서는 플랫폼 채널 호출을 생성자에 넘겨 경계를 연결하고, 실제 코드나 플러그인이 약속한 미지원 값과 예외를 확인한다.

### 사례 2 — 외부 JSON을 도메인 타입으로 변환

배송 API의 JSON은 외부 키와 문자열 상태를 사용한다. 앱은 공백이 제거된 주문 ID와 알려진 상태를 타입으로 받는다.

```dart
import 'dart:convert';

enum DeliveryState { pending, delivered }

typedef Delivery = ({String orderId, DeliveryState state});

Delivery parseDelivery(String body) {
  final Object? payload = jsonDecode(body);
  return switch (payload) {
    {'order_id': String id, 'delivery_state': String state}
        when id.trim().isNotEmpty =>
      (
        orderId: id.trim(),
        state: switch (state) {
          'P' => DeliveryState.pending,
          'D' => DeliveryState.delivered,
          _ => throw FormatException('Unknown delivery state: $state'),
        },
      ),
    _ => throw const FormatException('Invalid delivery payload'),
  };
}

void main() {
  final delivered = parseDelivery('{"order_id":" A4 ","delivery_state":"D"}');
  final pending = parseDelivery('{"order_id":"B7","delivery_state":"P"}');
  if (delivered != (orderId: 'A4', state: DeliveryState.delivered) ||
      pending != (orderId: 'B7', state: DeliveryState.pending)) {
    throw StateError('Unexpected delivery mapping');
  }
}
```

예시 JSON 두 개가 공백 없는 주문 ID와 해당 열거값으로 변환되면 정상 종료한다. 외부 필드 이름을 바꾸어 다시 실행하면 필수 입력이 없음을 알리는 `FormatException`이 발생한다.

### 사례 3 — 필드 누락과 전송 실패의 오류 매핑

지도 서비스에서 이름 필드가 빠진 응답과 요청을 전송하지 못한 경우를 구별해야 한다. 화면은 전송 오류일 때만 네트워크 재시도를 안내할 수 있어야 한다.

```dart
import 'dart:convert';
import 'dart:io';

enum PlaceFailure { transport, malformed }

class PlaceError implements Exception {
  PlaceError(this.kind, this.cause);

  final PlaceFailure kind;
  final Object cause;
}

class PlaceAdapter {
  PlaceAdapter(this._request);
  final Future<String> Function() _request;

  Future<String> readName() async {
    try {
      final Object? data = jsonDecode(await _request());
      if (data case {'name': String name} when name.trim().isNotEmpty) {
        return name.trim();
      }
      throw const FormatException('Expected the place name');
    } on SocketException catch (error) {
      throw PlaceError(PlaceFailure.transport, error);
    } on FormatException catch (error) {
      throw PlaceError(PlaceFailure.malformed, error);
    }
  }
}

Future<void> checkFailure(
  PlaceAdapter adapter,
  PlaceFailure kind,
  Type causeType,
) async {
  try {
    await adapter.readName();
    throw StateError('Expected a mapped failure');
  } on PlaceError catch (error) {
    if (error.kind != kind || error.cause.runtimeType != causeType) rethrow;
  }
}

Future<void> main() async {
  await checkFailure(
    PlaceAdapter(() async => '{"id":42}'),
    PlaceFailure.malformed,
    FormatException,
  );
  await checkFailure(
    PlaceAdapter(() async => throw const SocketException('Offline')),
    PlaceFailure.transport,
    SocketException,
  );
}
```

Dart VM에서 코드를 실행한다. 이름이 없는 응답은 `malformed`가 되고, 소켓 오류는 `transport`가 되며 원인도 각 오류에 보존되면 정상 종료한다. 웹용 어댑터는 `dart:io` 대신 해당 전송 클라이언트의 오류 타입을 사용한다.

## 관련 문서

- [Repository](repository.md)에서 변환한 데이터를 불러오고 캐시를 관리한다.
- [Factory](factory.md)에서 검증을 통과한 값의 생성 경계를 둔다.
- [Flutter 플랫폼 채널](https://docs.flutter.dev/platform-integration/platform-channels)
