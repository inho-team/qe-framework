# 발표 덱 근거 발췌 노트 (qe-framework-pitch.ko.html)

> 모든 인용은 아래 4개 문서에서만. 슬라이드 본문 수치는 이 노트와 일치해야 함.

## S2 — 왜 Claude CLI인가
- 출처: `core/PHILOSOPHY.md` "Hook Lifecycle Events (9)" + README.md
- 근거: 프레임워크는 **9개 Claude Code 플러그인 라이프사이클 이벤트**에 훅을 건다
  (SessionStart, PreToolUse, PostToolUse, PreCompact, Stop, UserPromptSubmit,
  Notification, TeammateIdle, TaskCompleted).
- 함의(추론): 이런 9개 훅·플러그인(스킬/에이전트)·모델 라우팅 표면은 CLI 플러그인에서만
  열린다. GUI 챗은 계측·자동화 표면이 없다. → 발표자 노트에 "근거: 추론" 표기.

## S3 — 왜 프레임워크인가 (raw AI 4대 실패점)
- 출처: `core/PHILOSOPHY.md` "Why This Matters"
- No spec: AI가 추측 → 사용자는 예상 밖 결과
- No implementation discipline: 코드 변경과 검증이 섞여 무엇을 했는지 불명확
- No verification: AI가 "끝났다" 선언, 아무도 확인 안 함 → 버그 출시
- No supervision: 로컬 체크는 통과하나 실제 환경에서 실패
- 핵심 원칙(인용): "Work without a spec is guesswork / A spec without implementation is
  intent / Implementation without verification is hope / Verification without
  supervision is confirmation bias."

## S4 — QE의 답: PSE + SIVS
- 출처: `docs/SYSTEM_OVERVIEW.md`, `core/PHILOSOPHY.md`, README.md
- PSE 체인(사용자 워크플로우): Plan → Spec → Execute → Verify
  (/Qplan → /Qgs → /Qexecute → /Qexecute -verify)
- SIVS 루프(내부 품질 게이트): Spec → Implement → Verify → Supervise → (FAIL) Remediate
- Query/Execute 메시지(README): 모든 AI 작업은 Query와 Execute로 환원된다.

## S5 — 하네스 엔지니어링이란/왜
- 출처: `core/PHILOSOPHY.md`, `docs/SYSTEM_OVERVIEW.md`
- 철학(인용): "Efficiency is Accuracy." 컨텍스트 제약 환경에서 불필요한 토큰 = 드리프트 원인.
- 독립 검증 게이트(Mandatory Obligation #8): 한 스테이지는 자기 출력을 스스로 인증할 수 없다
  (self-reference 문제, 동종 엔진일 때 심각). fresh-context 적대적 sub-agent가 검증, FAIL은
  원인 스테이지로 **역방향** 라우팅.
- 모델 티어링: Strategy=Opus / Implementation=Sonnet / Parallel=Haiku.
- 폴더 인지 컨텍스트 메모리: 작업 디렉터리에 매칭되는 컨텍스트만 로드(root.md 항상 + glob 매칭).
- 토큰 효율 계층: 컨텍스트 로딩 / ContextMemo 중복 차단 / 140k 자동·170k 강제 압축 / 250줄 스킬 캡.

## S6 — 이점: 6개 하네스 메트릭 (출처: core/METRICS_SPEC.md, 수치 정확히 일치)
| # | 메트릭 | 정상 범위 | 경고 임계 |
|---|--------|-----------|-----------|
| 1 | Task Resolution Rate (완료율) | 85–100% | <70% |
| 2 | Code Churn Rate (작업당 변경 라인) | 50–200 라인/task | >500 라인/task |
| 3 | Verification Tax (검증/구현 시간비) | 0.1–0.5 | >1.0 |
| 4 | Harness Constraint Effect (훅 on/off 품질차) | +10–30% | 음수 |
| 5 | Defect Escape Rate (검증 통과 후 재수정률) | 0–5% | >15% |
| 6 | Pass@1 Rate (첫 시도 전체 통과율) | 60–80% | <40% |

## S7 — 장점 vs 단점
- 장점(인용/문서 기반): 4대 실패점 봉합, 6개 메트릭으로 정량화, 효율=정확성, 병렬 우선(Haiku
  Wave), 모델 티어링 비용 최적화, 폴더 인지 컨텍스트로 토큰 절감.
- 단점(추론 — 발표자 노트에 "근거: 추론" 표기):
  - 마이크로 작업 오버헤드 → 문서상 완화책: Qutopia SIMPLE 예외(≤3파일·단일액션·<3항목은 스펙 생략)
  - 학습 곡선(PSE 규율, 183+ 스킬)
  - 검증·감독의 토큰/시간 비용 → 이를 감시하려고 Verification Tax 메트릭 존재
  - 선택적 Codex 브리지의 구성 복잡성
  - 하네스 자체 유지보수 비용

## S8 — 결론
- 핵심 3줄: (1) AI 작업은 Query/Execute로 환원 (2) raw AI는 4지점에서 실패 (3) SIVS 루프가
  네 구멍을 닫고, 하네스가 그걸 강제·계측한다.
