# QE Framework

QE Framework는 Claude Code와 Codex를 위한 Plan 기반 작업·검증 프레임워크입니다.

```text
Claude: /Qplan "계정 복구 기능 구현"
Codex:  $Qplan "계정 복구 기능 구현"
```

`Qplan`이 지식 조회, 스펙, 실행, 검증을 내부적으로 진행합니다. `Qgenerate-spec`과 `Qexecute`는 설치되는 내부 단계이며 사용자 명령이 아닙니다.

공개 스킬: `Qgoal`, `Qplan`, `Qcritical-review`, `Qcommit`, `Qcompact`, `Qresume`, `Qupdate`, `Qversion`.

설치와 운영은 [INSTALL.md](INSTALL.md)와 [USAGE_GUIDE.md](USAGE_GUIDE.md)를 참고하세요.
