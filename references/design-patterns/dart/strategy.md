# Strategy

## 목적

가격 계산이나 입력 검증처럼 같은 흐름에서 교체되는 정책을 분리한다. 호출부는 계산이나 검증이 필요한 시점을 정하고, 주입받은 함수나 객체는 어떤 규칙을 적용할지 결정한다.

## 사용처

고객 등급에 따라 할인 공식이 달라지거나 같은 폼에서 온라인과 오프라인 검증을 선택할 때 유용하다. 정책이 한 곳의 짧은 조건문으로 끝나고 다른 경로에서 교체할 이유가 없다면 조건문으로 충분하다.

## 장단점

- Dart의 함수 타입을 사용하면 클래스 계층 없이도 생성자로 정책을 받고, 테스트에서는 작은 함수를 바로 주입할 수 있다.
- 서로 연관된 여러 연산이나 리소스가 함께 바뀌는 정책은 인터페이스로 묶으면 계약을 읽기 쉽다. 단순한 계산 함수까지 객체로 감싸면 생성과 전달 코드가 늘어난다.
- `null`이 검증 통과를 뜻하는지, 정책 미설정을 뜻하는지 분명해야 한다. 동기 함수, `Future` 반환 함수, 일반 함수에서 즉시 던지는 예외가 섞이면 호출자가 오류를 다룰 시점도 정해야 한다.

## 구현 방식

입력과 결과를 함수 타입으로 선언하고 생성자로 받는다. 호출 시마다 바뀌어야 하는 정책이면 선택 지점이 적절한 함수를 넘긴다. 정책들이 공유하는 연산이 함께 교체돼야 하면 `abstract interface class`로 묶는다. 비동기 정책은 검증 실패를 정상적인 결과로 표현할지 예외로 표현할지 정하고, 정책이 즉시 던진 예외와 나중에 완료된 오류를 같은 `Future` 계약으로 전달할 수 있다.

## 예시

Dart 3.0 이상에서 각 코드를 독립적으로 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다.

### 사례 1 — 조건별 가격 계산 함수 주입

주문 합계를 계산할 때 일반 고객은 정가를 지불하고 회원은 상품별로 10% 할인을 받는다. 주문 코드는 통화의 최소 단위로 합산하고, 할인 뒤 남는 소수 단위는 상품별로 버린다.

```dart
typedef PriceRule = int Function(int unitPrice);

class Checkout {
  Checkout(this._priceRule);
  final PriceRule _priceRule;

  int total(Iterable<int> prices) {
    return prices.fold(0, (total, price) => total + _priceRule(price));
  }
}

int regularPrice(int price) => price;
int memberPrice(int price) => (price * 90) ~/ 100;

void main() {
  const items = [105, 200];
  final regular = Checkout(regularPrice);
  final member = Checkout(memberPrice);
  if (regular.total(items) != 305 || member.total(items) != 274) {
    throw StateError('Unexpected checkout price');
  }
}
```

동일한 상품을 두 정책으로 계산해 일반 합계 305, 회원 합계 274를 확인한다. 시스템에서 음수 조정이나 주문 합계에 대한 반올림도 지원한다면 가격 정책의 입력과 적용 단위를 함께 정의한다.

### 사례 2 — Future 기반 검증 정책 선택

팀 가입 코드 입력은 온라인에서는 서버에 등록된 코드를 검증하고, 오프라인에서는 대문자 네 글자 형식만 검사한다. 두 정책을 같은 호출 방식으로 실행하되 화면에서 형식 통과와 서버 승인 여부를 구별할 수 있어야 한다.

```dart
enum CodeCheck { rejected, formatOnly, remotelyApproved }

typedef CodePolicy = Future<CodeCheck> Function(String);

class InviteForm {
  InviteForm(this._check);
  final CodePolicy _check;

  Future<CodeCheck> validate(String input) => _check(input.trim());
}

Future<CodeCheck> checkFormat(String code) async {
  return RegExp(r'^[A-Z]{4}$').hasMatch(code)
      ? CodeCheck.formatOnly
      : CodeCheck.rejected;
}

Future<void> main() async {
  Future<bool> serverAllows(String code) async => code == 'TEAM';
  final online = InviteForm((code) async {
    return await serverAllows(code)
        ? CodeCheck.remotelyApproved
        : CodeCheck.rejected;
  });
  final offline = InviteForm(checkFormat);

  if (await online.validate(' TEAM ') != CodeCheck.remotelyApproved ||
      await online.validate('ABCD') != CodeCheck.rejected ||
      await offline.validate('ABCD') != CodeCheck.formatOnly) {
    throw StateError('Unexpected invite validation result');
  }
}
```

온라인 정책은 `TEAM`만 승인하고, 오프라인 정책은 다른 네 글자 코드도 형식에 한해 통과시키면 정상 종료한다. 연결 상태를 바꿀 수 있는 화면은 검증을 시작할 때 사용할 정책을 명시적으로 선택한다.

### 사례 3 — null과 비동기 예외 계약

닉네임 검증 정책은 성공 시 `null`, 입력을 거절할 때 오류 문구를 반환한다. 시스템이 검증을 수행하지 못한 경우에는 즉시 발생한 예외와 완료 시점에 발생한 예외를 모두 `Future`의 오류로 전달해야 한다.

```dart
import 'dart:async';

typedef NicknamePolicy = Future<String?> Function(String);

class NicknameValidation {
  NicknameValidation(this._policy);
  final NicknamePolicy _policy;

  Future<String?> validate(String nickname) {
    return Future.sync(() => _policy(nickname));
  }
}

Future<void> expectTimeout(NicknameValidation validation) async {
  final pending = validation.validate('Ara');
  try {
    await pending;
    throw StateError('Expected a timeout');
  } on TimeoutException {
    return;
  }
}

Future<void> main() async {
  final length = NicknameValidation((name) async {
    return name.length < 3 ? '세 글자 이상 입력' : null;
  });
  if (await length.validate('Ara') != null ||
      await length.validate('Al') != '세 글자 이상 입력') {
    throw StateError('Unexpected nickname validation');
  }
  await expectTimeout(
    NicknameValidation((_) => throw TimeoutException('Before returning')),
  );
  await expectTimeout(
    NicknameValidation((_) async => throw TimeoutException('Async response')),
  );
}
```

검증 통과와 입력 거절을 결과 값으로 구분하고, 두 시간 초과를 모두 `await`에서 잡아야 정상 종료한다. `Future.sync`를 제거해 정책을 바로 반환하면 즉시 던지는 예외는 검증용 `try`에 들어가기 전에 발생한다.

## 관련 문서

- [Factory](factory.md)에서 설정을 기준으로 정책 구현을 선택하고 생성한다.
- [State](state.md)에서 정책의 결과를 사용자에게 표시할 상태로 전환한다.
- [Dart의 Future.sync](https://api.dart.dev/dart-async/Future/Future.sync.html)
