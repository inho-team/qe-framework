# QE Framework 문서 안내

> 📖 **브라우저로 바로 보기**: [입문 Intro →](https://inho-team.github.io/qe-framework/qe_framework_intro.ko.html) · [전체 Reference →](https://inho-team.github.io/qe-framework/qe_framework_diagram.ko.html)
>
> **다른 언어**: [English](https://inho-team.github.io/qe-framework/qe_framework_intro.en.html) · [日本語](https://inho-team.github.io/qe-framework/qe_framework_intro.ja.html) · [中文](https://inho-team.github.io/qe-framework/qe_framework_intro.zh.html)

QE Framework는 Claude Code와 Codex를 함께 지원하는 스펙 기반 작업 프레임워크입니다.

기본 흐름:

```text
/Qplan -> /Qgs -> /Qatomic-run -> /Qcode-run-task
```

이 문서는 한국어 진입 문서입니다. 전체 설명을 한 파일에 몰아넣기보다, 주제별 문서로 나눠 안내합니다.

## 먼저 볼 문서

- 프로젝트 개요: [../README.md](../README.md)
- 철학과 설계 의도: [PHILOSOPHY.md](PHILOSOPHY.md)
- 상세 사용법: [USAGE_GUIDE.md](USAGE_GUIDE.md)
- 문서 전체 지도: [DOCUMENTATION_MAP.md](DOCUMENTATION_MAP.md)
- 멀티모델 설정: [MULTI_MODEL_SETUP.md](MULTI_MODEL_SETUP.md)
- 시스템 개요: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)

## v7.0 주요 기능

QE Framework v7.0는 다음의 고급 기능과 확장성을 제공합니다:

- **9개 라이프사이클 Hook** — Claude Code 플러그인이 지원하는 전체 이벤트 커버리지
- **effort 파라미터** — 작업 복잡도에 따른 추론 깊이 관리
- **Skill Budget 자동 관리** — 토큰 사용량 추적 및 동적 할당
- **하네스 엔지니어링 메트릭 6종** — 실행 성능, 품질, 안정성 측정
- **Agent Teams 및 Dynamic Workflows** — 다중 에이전트 협업 및 동적 작업 흐름
- **183+ Skill** 및 **25+ Agent** — 확장 가능한 스킬셋과 에이전트 라이브러리

## 핵심 개념

- `single-model`
  - Claude만 사용하는 기본 경로
  - `/Qatomic-run`은 Haiku swarm 기반 atomic execution
- `hybrid`
  - 일부 역할만 외부 runner 사용
- `multi-model`
  - planner / implementer / reviewer / supervisor를 역할별로 명시적으로 분리
- `tiered-model`
  - 같은 provider 안에서 난이도에 따라 상·중·하 모델을 나눠 사용

## 구독 조합별 권장 방향

| 사용 가능 도구 | 권장 모드 | 권장 기본 매핑 |
|----------------|-----------|----------------|
| Claude만 | `single-model` | Claude가 전 역할 담당 |
| Claude tiered | `tiered-model` | planner/supervisor = Opus, implementer/reviewer = Sonnet, 단순 작업 보조 = Haiku |
| Codex tiered | `tiered-model` | planner/supervisor = GPT-5.4, implementer/reviewer = GPT-5-Codex, 단순 작업 보조 = GPT-5-Codex-Mini |
| Claude + Codex | `hybrid` | implementer = Codex, 나머지 = Claude |
| Claude + Gemini | `hybrid` | reviewer = Gemini, 나머지 = Claude |
| Claude + Codex + Gemini | `multi-model` | planner/supervisor = Claude, implementer = Codex, reviewer = Gemini |

## 빠른 시작

1. 설치

```bash
claude plugin marketplace add inho-team/qe-framework
claude plugin install qe-framework@inho-team-qe-framework
```

설치는 **dual-target**입니다 — Claude와 Codex 양쪽에 설치됩니다.

- **Claude**: 스킬·에이전트·core·hooks·scripts를 `~/.claude`에 설치.
- **Codex**(`~/.codex` 존재 시): 스킬→`~/.codex/skills`, 에이전트→`~/.codex/agents/*.toml`,
  `~/.codex/config.toml`에 에이전트 fence + `[[hooks.PreToolUse]]` 안전훅 fence. Codex 사용자가
  아니면(`~/.codex` 없음) 조용히 skip. 설치 후 Codex에서 `/hooks`로 안전훅을 1회 승인해야 합니다.

**정직한 천장**: ✅ 설치 + 안전가드는 Codex에서 지원됩니다. Codex `PreToolUse` 훅은 trust 후 raw
git commit·gh pr create·sed -i·plugin.json 버전쓰기 차단을 수행합니다. ✅ HUD는 native statusline이
아니라 `$Qhud`/`~/.codex/scripts/qe-hud.mjs` command proxy로 shell/tmux/manual 렌더링을 지원합니다. ⚠️ E-에이전트 위임 스킬은
Codex에서 **인라인 degrade**(Codex는 명시적 `/agent`로만 서브에이전트 spawn, 자동 위임 없음).
SIVS 단계를 Codex **엔진**으로 라우팅하는 것도 `codex-plugin-cc`+`/Qsivs-config`로 가능.
측정된 Claude/Codex parity는 `.qe/planning/plans/codex-native-parity/VERIFICATION_MATRIX.md`를 기준으로 합니다.

> `qe-framework-uninstall`은 Claude 자산을, `--purge-codex`와 함께면 Codex 자산까지 제거합니다
> (기본은 dry-run 보고만, 비-QE 자산 보존).

2. 프로젝트 초기화

```text
/Qinit
```

Codex에서는 다음처럼 skill 이름으로 호출할 수 있습니다.

```text
$Qinit
```

3. 작업 흐름 시작

```text
/Qplan
/Qgs
/Qatomic-run
/Qcode-run-task
```

## 참고

- quota 차단 시 임시 대체 runner는 `--role-override`로 재실행합니다.
- 이 override는 현재 실행에만 적용되고 `team-config.json`은 바꾸지 않습니다.

## ⚠️ 자율 실행 모드 (`/Qutopia`)

`/Qutopia`는 **모든 확인 프롬프트를 건너뛰고** 자동으로 진행하는 세션 스위치입니다. 작업은 빨라지지만, 잘못된 파일을 커밋하거나 `main`에 직접 push할 수 있는 위험이 있습니다.

**켜기 전 필수 체크**:
1. 요구사항이 명확한가 (원자적 checklist 있음)
2. 모든 단계가 되돌릴 수 있는가 (force-push · 마이그레이션 · 파괴적 삭제 없음)
3. working tree가 깨끗한가 (무관한 변경 섞이지 않음)
4. 공유 branch(`main`/`master`)가 아닌가
5. 자동 커밋·자동 iteration을 허용하는가

전체 가이드와 켜고 끄는 권장 패턴은 [USAGE_GUIDE.md §10](USAGE_GUIDE.md#10-autonomous-mode-qutopia--%EF%B8%8F-read-before-enabling)에서 확인하세요. **세션 종료 전에는 반드시 `/Qutopia off`를 실행**하세요.
