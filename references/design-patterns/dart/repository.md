# Repository

## 목적

데이터를 읽고 쓰는 앱 기능에 도메인 타입과 일관된 반환 계약을 제공한다. 저장소는 데이터를 어디서 가져올지, 언제 캐시를 갱신할지, 어떤 실패를 호출자에게 전달할지 결정한다.

## 사용처

프로필을 조회하는 기능을 여러 화면에서 쓰거나 메모리, 기기 저장소, 원격 API를 환경에 따라 교체할 때 유용하다. 데이터 공급자가 하나이고 호출부 한 곳에서 쓰는 경우에는 기존 서비스에 도메인 반환형을 지정해 직접 사용해도 충분할 수 있다.

## 장단점

- 호출부는 저장 위치와 DTO를 몰라도 되므로, 생성자에서 계약을 주입받고 테스트에서 메모리 구현을 쓸 수 있다.
- 캐시를 도입하면 응답 지연과 네트워크 사용량을 줄일 수 있다. 만료 시간, 사용자 변경 시 무효화, 동시 쓰기 순서를 관리해야 하며 잘못된 식별자나 정책으로 오래된 값이 남을 수 있다.
- `Future<T?>`는 값이 없다는 결과를 간결하게 표현한다. 오류까지 `null`로 합치면 호출자가 미등록, 네트워크 오류, 파싱 오류를 구별하거나 재시도 여부를 결정하기 어렵다.

## 구현 방식

앱의 읽기·쓰기 동작과 도메인 타입을 인터페이스로 정의한다. 조립 지점이 원격 또는 로컬 구현을 고르고 호출부는 생성자로 받는다. 원격 응답의 자료형을 바꾸는 작업은 어댑터에 맡길 수 있다. 캐시가 있으면 키, 유효 기간, 만료 데이터 사용 조건을 정하고, 캐시 읽기·쓰기 실패와 원격 실패를 각각 어떻게 노출할지 문서화한다. 비동기 결과를 화면에 게시하는 시점의 수명 판단은 화면이나 화면 상태의 소유자가 맡는다.

## 예시

Dart 3.0 이상에서 각 코드를 독립적으로 `example.dart`에 저장하고 `dart analyze example.dart`와 `dart run example.dart`를 실행한다. 로컬 저장소와 원격 공급자는 메모리 대역으로 재현한다.

### 사례 1 — 프로필 조회에 로컬 구현 주입

프로필 제목을 만드는 기능은 사용자 ID로 표시 이름을 읽고, 등록된 사용자가 없으면 기본 제목을 사용한다. 개발 환경에서는 프로필 저장소를 메모리 구현으로 교체한다.

```dart
abstract interface class ProfileRepository {
  Future<String?> displayNameFor(String userId);
}

class LocalProfiles implements ProfileRepository {
  LocalProfiles(Map<String, String> names) : _names = Map.unmodifiable(names);

  final Map<String, String> _names;

  @override
  Future<String?> displayNameFor(String userId) async => _names[userId];
}

class LoadProfile {
  LoadProfile(this._profiles);
  final ProfileRepository _profiles;

  Future<String> call(String userId) async {
    return await _profiles.displayNameFor(userId) ?? '이름 미등록';
  }
}

Future<void> main() async {
  final loadProfile = LoadProfile(LocalProfiles({'u1': '아라'}));
  if (await loadProfile('u1') != '아라' ||
      await loadProfile('unknown') != '이름 미등록') {
    throw StateError('Unexpected profile title');
  }
}
```

등록된 ID는 표시 이름을, 없는 ID는 기본 제목을 얻으면 정상 종료한다. `null`은 사용자 부재로 정의하므로 원격 구현을 주입할 경우 전송 실패나 파싱 실패는 별도 오류로 유지한다.

### 사례 2 — 원격 조회와 캐시를 한 계약으로 제공

상품 정보를 열 때 처음에는 서버를 조회하고, 앱 세션 동안 같은 상품을 다시 열면 메모리 캐시를 쓴다. 미등록 상품은 다음 조회 때 다시 확인한다.

```dart
typedef Product = ({String sku, String name});

abstract interface class ProductRepository {
  Future<Product?> find(String sku);
}

class CachedProducts implements ProductRepository {
  CachedProducts(this._fetch);

  final Future<Product?> Function(String) _fetch;
  final _cache = <String, Product>{};

  @override
  Future<Product?> find(String sku) async {
    final cached = _cache[sku];
    if (cached != null) return cached;

    final product = await _fetch(sku);
    if (product != null) _cache[sku] = product;
    return product;
  }
}

Future<void> main() async {
  var remoteReads = 0;
  final ProductRepository products = CachedProducts((sku) async {
    remoteReads++;
    return sku == 'T-5' ? (sku: sku, name: '차') : null;
  });
  final first = await products.find('T-5');
  final second = await products.find('T-5');
  final missing = await products.find('absent');
  final missingAgain = await products.find('absent');
  if (first?.name != '차' ||
      first != second ||
      missing != null ||
      missingAgain != null ||
      remoteReads != 3) {
    throw StateError('Unexpected cache policy');
  }
}
```

정상 상품은 원격에서 한 번만 읽고 미등록 ID는 두 번 읽으면 정상 종료한다. 이 구현은 순차 조회를 보여 준다. 동일 키를 동시에 읽을 때 원격 호출을 공유해야 한다면 진행 중인 `Future`의 공유와 오류 뒤 제거도 저장소가 맡는다.

### 사례 3 — 캐시 만료와 원격 실패 구분

재고 조회는 유효 기간 안에는 로컬 값을 반환하고, 만료되면 원격에서 새 값을 읽는다. 만료 뒤 원격에 접속할 수 없으면 마지막 재고와 만료 상태를 함께 제공한다. 캐시가 없으면 원격 오류를 전달한다.

```dart
enum StockSource { freshCache, remote, staleCache }

typedef Stock = ({int units, StockSource source});

class SourceOffline implements Exception {}

class StockRepository {
  StockRepository(this._now, this._fetch);

  final DateTime Function() _now;
  final Future<int> Function() _fetch;
  ({int units, DateTime fetchedAt})? _saved;

  Future<Stock> read() async {
    final saved = _saved;
    if (saved != null &&
        _now().difference(saved.fetchedAt) < const Duration(minutes: 5)) {
      return (units: saved.units, source: StockSource.freshCache);
    }

    try {
      final units = await _fetch();
      _saved = (units: units, fetchedAt: _now());
      return (units: units, source: StockSource.remote);
    } on SourceOffline {
      if (saved == null) rethrow;
      return (units: saved.units, source: StockSource.staleCache);
    }
  }
}

Future<void> main() async {
  var now = DateTime.utc(2026);
  var offline = false;
  var units = 7;
  Future<int> fetch() async {
    if (offline) throw SourceOffline();
    return units;
  }

  final stock = StockRepository(() => now, fetch);
  if ((await stock.read()).source != StockSource.remote) {
    throw StateError('Initial read must use the remote source');
  }
  offline = true;
  if ((await stock.read()).source != StockSource.freshCache) {
    throw StateError('An unexpired entry should satisfy the read');
  }
  now = now.add(const Duration(minutes: 5));
  if (await stock.read() != (units: 7, source: StockSource.staleCache)) {
    throw StateError('Expired data must be marked as stale');
  }

  final empty = StockRepository(() => now, fetch);
  try {
    await empty.read();
    throw StateError('Expected remote failure with no cache');
  } on SourceOffline {
    offline = false;
    units = 9;
  }
  if (await stock.read() != (units: 9, source: StockSource.remote)) {
    throw StateError('Recovered remote source must refresh the cache');
  }
}
```

가짜 시계를 만료 시점까지 진행시켜 새 캐시, 만료된 캐시, 캐시가 없는 경우를 비교한다. 원격이 복구되면 새 재고를 받아야 정상 종료한다. 디스크를 쓰는 저장소라면 캐시 데이터 손상과 저장 실패도 원격의 일시적 연결 실패와 구분해 처리한다.

## 관련 문서

- [Adapter](adapter.md)에서 외부 자료형과 오류를 도메인 계약으로 변환한다.
- [ViewModel](viewmodel.md)에서 저장소 결과를 화면 상태에 반영한다.
- [Flutter 앱 아키텍처의 Repository](https://docs.flutter.dev/app-architecture/guide#repositories)
