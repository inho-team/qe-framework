# QE v9 — 가벼운 단일 경로로 재작성 (설계)

- 날짜: 2026-11-23
- 상태: 승인됨 (2026-11-23)

## 의도와 이유

QE v8은 너무 무겁고 복잡하다. 스킬 12개·에이전트 12개, `core/` 계약 문서 30여 개,
hooks 3.2MB, 검사 스크립트 40여 개, SQLite DB(`.qe/`), 질문 수 상한(30/12/3)·Goal당
허용 경로 1–5개 같은 숫자 규칙이 모델의 판단을 대신한다. 사용자는 이것이 **AI 모델
자체를 억압한다**고 느낀다.

v9의 목표: **큰 작업을 처리하는 길 하나를 정의하고, 다양한 작업이 모두 그 길을 따라
처리되게 한다.** 길은 정해 두되 각 단계 안에서는 모델의 판단을 믿는다. 철학은
SuperPowers와 비슷하게 가되, **작업마다 Spec 문서와 검증 문서를 남긴다**는 점이
QE만의 차이다.

v8에서 반드시 지켜야 할 것은 없다(사용자 확인). Codex/Ollama 지원, 교차 모델 검증,
감사 로그, DB, 세션 스냅샷 모두 v9에서 제거한다.

## 목표

1. 길 하나: **이해 → 계획(Spec) → 실행 → 검증.** 버그·기능·리팩터링 등 코딩 작업이 모두 이 길을 탄다. 세션 이어받기(Qresume)는 길 밖의 보조 장치.
2. 작업마다 저장소 안에 평범한 마크다운 문서를 남긴다. 읽는 사람은 둘이다.
   - **사용자 본인**: "왜 이렇게 만들었지?"
   - **다음 세션의 AI**: "어디까지 했고 다음은 뭐지?"
3. 스킬 수는 적게(아래 5개). 규칙은 숫자·스키마가 아니라 **이유**로 쓴다.
4. 설치는 Claude Code 플러그인 마켓플레이스 두 줄로 끝난다.

## 비목표

- Codex, Ollama, 다른 AI 클라이언트 지원
- 코딩 밖의 일(문서 작성 전용 워크플로, 리서치 보고서 등) 전용 경로
- 기존 v8 사용자 프로젝트의 `.qe/` DB 데이터 이관 (안내만 한다)
- 대시보드, 메트릭, 벤치마크, 평가 하네스

## 반목표 (기술적으로 돌아가도 실패인 것)

- 스킬이 다시 늘어나 사용자가 "무엇을 불러야 하지?"를 고민하게 되는 것
- 모델 행동을 hook·검사 스크립트·숫자 상한으로 강제하는 장치가 다시 쌓이는 것.
  **기준: "이게 없으면 모델이 실제로 실패하는가?"에 '예'라고 답할 수 없으면 넣지 않는다.**
- 아무도 안 읽는 문서를 의무적으로 양산하는 것 (작은 작업의 문서는 짧아야 한다)
- 문서를 특수 도구로만 읽을 수 있는 것 (DB, 전용 CLI 등)

## 제약

- Claude Code 플러그인 형식(`.claude-plugin/plugin.json`, `marketplace.json`).
- `package.json`과 `.claude-plugin/plugin.json`(그리고 `marketplace.json`)의 버전은 같이 맞춘다 (AGENTS.md 규칙). v9.0.0.
- 사용 환경에 Windows가 포함된다 → hook은 Node 스크립트 하나로 (셸 의존 없음).
- SuperPowers(MIT)의 문장이나 아이디어를 빌려 쓸 경우 `THIRD_PARTY_NOTICES.md`에 출처를 밝힌다.

## 접근 방식 (검토한 것)

| 안 | 내용 | 장단점 |
|---|---|---|
| **A. 처음부터 새로 쓰기 (선택)** | SuperPowers 철학을 빌려 스킬 6개짜리 작은 QE를 새로 쓴다. v8 자산은 대부분 삭제. | 길과 문서 형식을 온전히 소유. 처음 쓰는 비용이 든다. |
| B. SuperPowers 포크 후 수정 | MIT 코드를 가져와 고친다. | 가장 빠르나 스킬 14개를 떠안아 "스킬이 너무 많다"로 회귀, 원본과 차이가 계속 벌어짐. |
| C. SuperPowers 위 부가 플러그인 | 문서 규칙만 추가. | 가장 작지만 길이 SuperPowers 소유가 되고 버전 변화에 끌려감. QE를 직접 소유하려는 방향과 맞지 않음. |

사용자가 **A**를 선택했다. 이유: 무거움의 원인을 남김없이 걷어내고, SuperPowers에
없는 검증 문서를 길의 중심에 둘 수 있다.

## 사용자가 정한 것

- 새로 쓴다 (A안). v8 자산은 "대거 걷어낸다".
- DB를 없앤다. 모든 기록은 저장소 안 마크다운 파일.
- Spec 문서와 검증 문서를 남긴다. 독자는 사용자 본인과 다음 세션 AI.
- 길: 이해 → 계획(Spec) → 실행 → 검증. 스킬은 Qunderstand, Qplan, Qexecute, Qverify, Qresume 5개.
- 검증은 상황에 따라 메인 세션 또는 서브에이전트가 한다 (모델이 선택).
- Qresume: handoff 문서 작성 후 compact, 새 세션 시작 시 자동 이어받기.
- CI(Jenkins)와 검사 스크립트는 두지 않는다.
- 아주 작은 일은 문서 없이 바로 한다.

## 설계

### 길 (하나)

```
이해        →  계획(Spec)        →  실행      →  검증
Qunderstand    Qplan                Qexecute     Qverify
               (spec.md, plan.md    (plan.md     (verify.md)
                → 사용자 승인)        체크 갱신)

Qresume: 어느 단계에서든 세션을 넘길 때 handoff.md 작성 → compact,
         새 세션 시작 시 자동으로 이어받기
```

- **이해 (Qunderstand)**: 한 번에 질문 하나. 저장소가 답하는 것은 묻지 않는다. 이해한 것을 사용자 말로 되들려준다. 접근 방식 2–3개를 비교하고 하나를 추천해 사용자가 고르게 한다.
- **계획 (Qplan)**: 이해한 내용을 Spec으로 쓰고, 실행 가능한 작은 단계로 나눈다. 각 단계에 "어떻게 확인할지"를 적는다. 사용자가 승인해야 실행으로 간다 (유일한 강한 게이트).
- **실행 (Qexecute)**: 계획대로 진행하며 `plan.md`의 체크박스를 갱신한다. 계획과 어긋나면 멈추고 사용자에게 말한다.
- **검증 (Qverify)**: Spec 대비 결과를 확인하고 `verify.md`에 쓴다. **메인 세션에서 할지, 새 컨텍스트의 서브에이전트에 맡길지는 상황에 따라 모델이 고른다**(사용자 결정). 예: 작은 변경은 메인에서, 큰 변경이나 메인이 직접 많이 쓴 코드는 자기 채점을 피하려 서브에이전트로. 어느 쪽을 골랐는지와 이유를 verify.md에 한 줄 남긴다.
- **이어받기 (Qresume)**: 세션을 넘길 때 현재 작업 폴더에 `handoff.md`(지금 어디까지, 다음 할 일, 주의할 점)를 쓰고 compact로 넘어간다. 새 세션이 시작되면(SessionStart hook, `startup|clear|compact`) 자동으로 미완료 작업과 handoff를 읽어 이어간다.
  - 제약: 모델은 내장 `/compact`를 직접 실행할 수 없다. Qresume은 handoff.md를 쓴 뒤 사용자에게 `/compact` 실행을 요청하고, compact 직후 SessionStart(compact)가 handoff를 다시 주입한다.

작업 크기에 따라 길이가 줄어든다: 아주 작은 일(오타, 한 줄 수정)은 문서 없이 바로 하고 결과만 보고한다. 작은 일은 짧은 spec.md(몇 줄)와 짧은 verify.md. 판단은 모델에게 맡기되, 판단 근거를 사용자에게 한 줄로 말한다.

### 스킬 (5개, 사용자 결정)

| 스킬 | 호출 | 역할 |
|---|---|---|
| `Qunderstand` | `/Qunderstand`, 또는 새 작업 시작 시 | 이해 대화 → 접근 방식 선택 |
| `Qplan` | 이해가 끝난 뒤 | spec.md + plan.md 작성 → 사용자 승인 |
| `Qexecute` | 계획 승인 후 | 계획 실행, 진행 상황을 plan.md에 기록 |
| `Qverify` | 실행 후, 또는 완료 주장 전 | 메인 또는 서브에이전트 검증 → verify.md |
| `Qresume` | 세션을 넘길 때 / 새 세션 시작 시 자동 | handoff.md 작성 → compact 요청 / 미완료 작업 이어받기 |

길 안내(언제 어떤 스킬로 들어가는지)는 별도 스킬 없이 SessionStart hook 출력에 짧게 넣는다 (설계자 판단 — 스킬 수를 5개로 지키기 위해).

`Qplan`·`Qexecute`·`Qresume`이라는 v8 이름은 유지하되 의미는 새로 정의한다. v8의 `Qgoal`, `Qgenerate-spec`, `Qcritical-review`, `Qcommit`, `Qcompact`, `Qdashboard`, `Qcc-setup`, `Qupdate`, `Qversion`은 삭제한다.

각 스킬의 SKILL.md는 짧게(목표: 150줄 이하), "무엇을·왜" 위주. 서브에이전트에 줄 프롬프트는 스킬 폴더 안 별도 파일(예: `skills/Qverify/verifier-prompt.md`).

### 문서 (작업 하나 = 폴더 하나)

```
docs/qe/2026-11-23-<주제>/
  spec.md     (Qplan) 의도와 이유, 목표/비목표, 검토한 접근과 선택 이유, 결정, 남은 판단
  plan.md     (Qplan) 단계 목록(체크박스), 단계별 확인 방법 — Qexecute가 갱신
  verify.md   (Qverify) 검증 주체(메인/서브)와 이유, 무엇을 어떻게 확인했는지(명령과 결과), 확인 못 한 것, 남은 일
  handoff.md  (Qresume) 지금 어디까지, 다음 할 일, 주의할 점 — 세션을 넘길 때만
```

- 상태(진행 중/완료)는 별도 파일 없이 `plan.md` 체크박스와 `verify.md` 유무로 알 수 있게 한다.
- 문서 위치는 사용자 프로젝트의 `docs/qe/`가 기본. 프로젝트가 다른 위치를 원하면 따른다.

### Hook

`hooks/hooks.json`에 SessionStart 하나만 (matcher `startup|clear|compact`):
짧은 길 안내와, 사용자 프로젝트 `docs/qe/`의 미완료 작업 및 최신 `handoff.md`를 세션 컨텍스트에 주입한다. PreToolUse/PostToolUse/Stop/UserPromptSubmit/TeammateIdle/TaskCompleted는 제거.

### 에이전트

`agents/` 디렉터리 제거. 서브에이전트는 스킬이 프롬프트 파일로 직접 띄운다.

### 삭제 대상 (저장소)

`core/`, `scripts/` 전부, `Jenkinsfile`, `.ci/`(CI 제거 — 사용자 결정), `hooks/scripts/`(session-start 제외), `hooks/git`, `hooks/hook-inventory.json`,
`agents/`, `bin/`, `install.js`, `uninstall.js`, `evals/`, `graft/`, `plugins/qissue-adapter`, `.agents/`,
`.qe/`, `QE.md`, `QE_CONVENTIONS.md`, `docs/` 기존 내용 전부(번역 README 포함, 단 이 설계 문서 `docs/superpowers/specs/`는 남긴다 — 설계자 판단), `skills/CATALOG.md`, 기존 스킬 폴더,
`package.json`의 postinstall/preuninstall 및 qe:* 스크립트, `optionalDependencies`(playwright).

v8 코드는 git 이력과 `v8.3.0` 태그로 남는다.

### 남기거나 새로 쓰는 것

- `README.md`: 짧게 새로 (무엇인지, 설치 두 줄, 길 그림, 문서 폴더 설명). 한국어/영어 중 하나 — 빌더 판단.
- `AGENTS.md`: 새 구조에 맞게 다시 쓴다.
- `CHANGELOG.md`: 유지, v9.0.0 항목 추가 (v8에서 무엇이 사라졌고 기존 사용자는 무엇을 하면 되는지).
- `LICENSE`, `THIRD_PARTY_NOTICES.md`(SuperPowers 출처 추가).
- `.claude-plugin/plugin.json`, `marketplace.json`: 설명·태그·기능 목록을 새 구조에 맞게.
- `package.json`: 버전 동기화 용도로만 유지. **npm 공개 배포는 중단**(사용자 결정): `private: true`, `publishConfig`·`bin`·`files`·lifecycle scripts 제거. 이미 올라간 npm 패키지에는 "v9부터 플러그인으로 설치" deprecate 안내를 한 번 남긴다(배포 명령 실행은 사용자 확인 후).
- **v8 잔여 파일 정리는 안내만**(사용자 결정): CHANGELOG v9.0.0 항목에 수동 삭제 절차를 적는다 — `~/.claude/{commands,agents,hooks,scripts}`의 QE 사본, `~/.codex`의 QE skills/agents/hooks, `config.toml`의 QE hook fence 블록. 이름이 같은 `Qplan`/`Qexecute`/`Qresume`의 v8 사본이 v9와 충돌할 수 있음을 경고한다. 정리 명령이나 정리 릴리스는 만들지 않는다.

## 빌더에게 맡기는 것

- 각 SKILL.md의 정확한 문구와 구성
- spec/plan/verify 템플릿의 세부 항목
- session-start hook 구현 세부
- README 언어
- 작업 분기 이름과 커밋 단위

## 미결

(없음 — 빌더 체크 질문 3건 해소: npm 배포 중단, v8 잔여 파일은 안내만, 이 설계 문서는 보존)
