# TypeScript 디자인 패턴

`tsconfig.json`에서 `strict`, `target`, `module`과 실제 배포 런타임을 확인한다. 내부 계약은 타입으로 표현하고 JSON, 설정, 외부 이벤트는 `unknown`에서 시작해 실행 중에 검사한다. 타입 단언은 값을 검사하거나 변환하지 않는다. [TypeScript의 strict 설정](https://www.typescriptlang.org/tsconfig/strict.html)

| 패턴 | 선택 기준 |
| --- | --- |
| [State](state.md) | 상태에 따라 필수 데이터, 가능한 작업 또는 다음 상태가 달라진다. |
| [Adapter](adapter.md) | 외부 데이터나 클라이언트의 계약을 애플리케이션 계약에 맞춘다. |
| [의존성 주입](dependency-injection.md) | 소비자가 사용할 구현을 실행 환경이나 테스트에 따라 바꾼다. |
| [Strategy](strategy.md) | 같은 입력을 처리하는 정책을 바꾸면서 호출 계약을 유지한다. |
| [Factory](factory.md) | 정해진 종류에 따라 객체를 만들거나 생성에 필요한 분기와 검증을 모은다. |
| [Decorator](decorator.md) | 호출 계약을 유지하면서 계측 등 공통 동작을 덧붙인다. |
| [Observer](observer.md) | 이벤트에 여러 소비자가 반응하며 구독 수명을 개별적으로 관리한다. |
| [Builder](builder.md) | 생성 단계마다 충족해야 하는 조건이 있거나 순서가 중요하다. |
| [옵션 객체](options-object.md) | 이름 있는 매개변수와 기본값만으로 호출 계약을 표현할 수 있다. |

## 예제 검증

각 사례의 코드 블록을 별도 폴더의 `example.ts`로 저장한다. TypeScript 4.9 이상과 ES2022를 지원하는 Node.js가 필요하다. 별도 import나 외부 서비스 없이 실행할 수 있다. 명령은 TypeScript 5.8.3을 사용한다. Windows PowerShell에서 `npx` 실행이 차단되면 `npx.cmd`를 사용한다.

```sh
npx --yes --package=typescript@5.8.3 tsc --strict --noEmit --target ES2022 --module commonjs example.ts
npx --yes --package=typescript@5.8.3 tsc --strict --target ES2022 --module commonjs --outDir out example.ts
node out/example.js
```

옵션 객체의 사례 3에는 두 컴파일 명령에 `--exactOptionalPropertyTypes`를 추가한다. `@ts-expect-error`는 다음 줄의 오류를 예상한다. 해당 주석만 삭제해 명시된 타입 오류가 발생하는지 확인할 수 있다. 예제에서 컴파일 검사용 함수는 실행하지 않는다. 실행 결과는 각 사례에 적은 출력과 비교한다.
