# Composition

## 목적

화면에 반복되는 표시와 상호작용을 작은 위젯으로 구성한다. 자식 위젯은 입력 속성을 받아 렌더링하고 콜백으로 이벤트를 알린다. 상위 위젯은 화면 정책과 여러 자식에 걸친 상태를 관리한다.

## 사용처

버튼의 외형은 같지만 화면마다 명령이 다르거나, 여러 화면이 입력 필드와 오류 표시를 공유할 때 유용하다. 상태가 한 필드 안에서만 쓰이면 그 필드가 소유하고, 여러 필드를 한 번에 검증해야 하면 폼이 상태를 소유한다. 위젯 트리가 짧고 화면 안에서 한 번만 쓰이면 기존 위젯을 바로 배치해도 충분하다.

## 장단점

- 입력과 이벤트가 생성자에 드러나므로 위젯을 다른 화면에 배치하고 위젯 테스트로 탭이나 입력 결과를 확인하기 쉽다.
- 공통 위젯이 화면별 정책까지 받기 시작하면 매개변수와 분기가 늘어난다. 자식의 상태를 부모로 옮기면 여러 자식이 같은 값을 참조할 수 있지만 갱신 범위가 넓어질 수 있다.
- 목록 상태를 항목마다 기억할 때 키 선택이 중요하다. 위치나 표시 이름을 키로 쓰면 재정렬이나 이름 변경 뒤 상태가 엉뚱한 항목으로 이동하거나 초기화될 수 있다.

## 구현 방식

상위 위젯이 현재 값과 콜백을 생성자로 내려주고, 하위 위젯은 표준 위젯을 조합한다. 여러 입력에 필요한 `FormState`는 폼 소유자가 관리한다. 직접 만든 컨트롤러나 구독은 소유자가 해제한다. 재정렬되는 목록에는 같은 부모 아래에서 유일하고 안정적인 항목 ID를 키로 주며, 키를 부모가 실제로 재정렬하는 자식에 붙인다.

## 예시

각 코드는 Dart 3.0 이상을 사용하는 Flutter 프로젝트에서 독립적으로 실행한다. `pubspec.yaml`에 Flutter SDK 및 개발 의존성 `flutter_test`를 추가하고 코드 전체를 `test/composition_test.dart`에 저장한 뒤 `flutter test test/composition_test.dart`를 실행한다.

### 사례 1 — 속성과 콜백을 받는 버튼

주문 화면이 공통 버튼을 쓰되, 버튼 문구와 탭 동작은 주문 화면이 정해야 한다. 실행 조건이 충족되지 않으면 콜백을 `null`로 전달해 버튼을 비활성화한다.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class ActionButton extends StatelessWidget {
  const ActionButton({super.key, required this.label, this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(onPressed: onPressed, child: Text(label));
  }
}

void main() {
  testWidgets('uses the label and delegates taps', (tester) async {
    var submissions = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ActionButton(label: '주문', onPressed: () => submissions++),
      ),
    ));
    await tester.tap(find.text('주문'));
    expect(submissions, 1);

    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: ActionButton(label: '주문')),
    ));
    expect(tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull);
    await tester.tap(find.text('주문'));
    expect(submissions, 1);
  });
}
```

테스트는 활성 버튼을 누르면 주문 콜백이 한 번 실행되고, 비활성 버튼을 눌러도 실행 횟수가 그대로인지 확인한다.

### 사례 2 — 작은 위젯을 합성한 입력 폼

배송 신청 폼은 이름과 주소를 둘 다 받은 뒤 제출해야 한다. 공통 필드가 필수 입력 규칙을 적용하고, 폼이 두 필드를 함께 검증해 호출자에게 값을 전달한다.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class RequiredField extends StatelessWidget {
  const RequiredField(this.label, {super.key, required this.onSaved});

  final String label;
  final FormFieldSetter<String> onSaved;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      decoration: InputDecoration(labelText: label),
      validator: (value) =>
          value == null || value.trim().isEmpty ? '필수 입력' : null,
      onSaved: onSaved,
    );
  }
}

class ShippingForm extends StatefulWidget {
  const ShippingForm({super.key, required this.onSubmit});

  final void Function(String, String) onSubmit;

  @override
  State<ShippingForm> createState() => _ShippingFormState();
}

class _ShippingFormState extends State<ShippingForm> {
  final _formKey = GlobalKey<FormState>();

  @override
  Widget build(BuildContext context) {
    final fields = <String, String>{};
    return Form(
      key: _formKey,
      child: Column(children: [
        RequiredField('이름', onSaved: (value) => fields['name'] = value!.trim()),
        RequiredField('주소', onSaved: (value) => fields['address'] = value!.trim()),
        ElevatedButton(
          onPressed: () {
            final form = _formKey.currentState!;
            if (!form.validate()) return;
            form.save();
            widget.onSubmit(fields['name']!, fields['address']!);
          },
          child: const Text('신청'),
        ),
      ]),
    );
  }
}

void main() {
  testWidgets('requires both fields before submitting', (tester) async {
    final submissions = <(String, String)>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ShippingForm(onSubmit: (name, address) {
          submissions.add((name, address));
        }),
      ),
    ));
    await tester.tap(find.text('신청'));
    await tester.pump();
    expect(find.text('필수 입력'), findsNWidgets(2));
    expect(submissions, isEmpty);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), ' Ara ');
    await tester.enterText(fields.at(1), 'Seoul');
    await tester.tap(find.text('신청'));
    expect(submissions, [('Ara', 'Seoul')]);
  });
}
```

테스트는 빈 폼에 오류 두 개가 표시되고 제출 콜백은 실행되지 않는지 확인한다. 이름과 주소를 입력한 뒤에는 앞뒤 공백이 제거된 값으로 제출이 한 번 일어난다.

### 사례 3 — 목록 재정렬 뒤 항목별 상태 유지

선택할 수 있는 배송 주소의 표시 순서가 바뀐다. 각 행이 선택 상태를 가지고 있으며, 순서를 바꾼 뒤에도 선택값은 같은 주소 ID에 남아야 한다.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class AddressRow extends StatefulWidget {
  const AddressRow(this.id, {super.key});

  final String id;

  @override
  State<AddressRow> createState() => _AddressRowState();
}

class _AddressRowState extends State<AddressRow> {
  bool selected = false;

  @override
  Widget build(BuildContext context) {
    return CheckboxListTile(
      title: Text(widget.id),
      value: selected,
      onChanged: (value) => setState(() => selected = value ?? false),
    );
  }
}

Widget addresses(List<String> ids) {
  return MaterialApp(
    home: Scaffold(
      body: Column(children: [
        for (final id in ids) AddressRow(id, key: ValueKey(id)),
      ]),
    ),
  );
}

void main() {
  testWidgets('selection follows the address ID after reorder', (tester) async {
    await tester.pumpWidget(addresses(['home', 'office']));
    await tester.tap(find.text('home'));
    await tester.pump();
    await tester.pumpWidget(addresses(['office', 'home']));

    final rows = tester.widgetList<CheckboxListTile>(find.byType(CheckboxListTile));
    expect(rows.map((row) => (row.title as Text).data), ['office', 'home']);
    expect(rows.map((row) => row.value), [false, true]);
  });
}
```

테스트는 두 번째 위치로 이동한 `home`만 선택되어 있는지 확인한다. `AddressRow`에서 키를 제거해 같은 테스트를 실행하면 위치의 상태가 재사용되어 마지막 검증에 실패한다.

## 관련 문서

- [State](state.md)에서 입력과 비동기 요청에 따른 상태 전이를 표현한다.
- [ViewModel](viewmodel.md)에서 여러 위젯이 공유하는 화면 상태와 명령을 조율한다.
- [Flutter 위젯의 키](https://docs.flutter.dev/ui#keys)
