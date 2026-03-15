---
name: Qautoresearch
description: "Autonomous experiment loop inspired by Karpathy's autoresearch. Repeatedly modifies target files, runs an experiment, evaluates a single metric, and keeps or discards the change — looping indefinitely until manually stopped. Use when optimizing code through iterative experimentation: ML training, algorithm benchmarks, build optimization, performance tuning, multi-file refactoring. Distinct from Edeep-researcher (web research) and Qutopia (task confirmation skip) — this skill runs a code-modify-evaluate loop."
metadata:
  source: https://github.com/karpathy/autoresearch
  author: Andrej Karpathy (pattern), inho-team (QE adaptation)
  version: "2.0.0"
  domain: experimentation
  triggers: autoresearch, experiment loop, autonomous experiment, iterate code, optimize training, hyperparameter sweep, multi-file experiment
  role: specialist
  scope: implementation
  output-format: results.tsv + git branch
  related-skills: Qutopia, Edeep-researcher, Ecode-debugger, Ecode-reviewer, Ecompact-executor, Qdata-analysis, Qlesson-learned
keywords: autoresearch, experiment, autonomous, loop, metric, optimize, iterate, keep, discard, git branch, results.tsv, multi-file
---

> Shared principles: see core/PRINCIPLES.md

# Autoresearch — Autonomous Experiment Loop

Karpathy의 autoresearch 패턴을 범용화한 자율 실험 스킬.
대상 파일(1개 또는 다수)을 반복 수정 → 실행 → 메트릭 평가 → keep/discard하며 무한 루프한다.

## When to Use

- **Use this skill** when: 코드를 반복 수정하며 단일 메트릭을 최적화하고 싶을 때 (ML 학습, 알고리즘 벤치마크, 빌드 최적화, 성능 튜닝, 다중 파일 리팩토링)
- **Use Edeep-researcher instead** when: 웹 검색 기반 조사·비교 분석이 필요할 때
- **Use Qutopia instead** when: 기존 태스크의 확인 단계를 스킵하고 자율 실행하고 싶을 때

## Phase 1: Setup (사용자와 1회 대화)

사용자에게 아래 정보를 수집한다. 이미 제공된 항목은 스킵.

| 항목 | 설명 | 예시 | 필수 |
|------|------|------|------|
| **tag** | 실험 세션 이름 (브랜치명에 사용) | `mar15` | ✅ |
| **target_files** | 에이전트가 수정할 파일 목록 (1개 이상). `target_file` 단수형도 허용 (하위 호환) | `train.py, model.py` 또는 `train.py` | ✅ |
| **fixed_files** | 절대 수정 금지 파일 목록 | `prepare.py` | ✅ |
| **run_command** | 실험 실행 명령어 | `uv run train.py` | ✅ |
| **metric_grep** | 메트릭 추출 grep 패턴 | `grep "^val_bpb:" run.log` | ✅ |
| **metric_direction** | 메트릭 방향 | `lower_is_better` 또는 `higher_is_better` | ✅ |
| **time_budget** | 실험당 시간 예산 (초) | `300` (기본값) | 선택 |
| **timeout_multiplier** | 타임아웃 배수 | `2` (기본값) | 선택 |
| **context_files** | 에이전트가 읽어야 할 참조 파일 | `README.md` | 선택 |

> **하위 호환**: `target_file: train.py` (단수)로 입력해도 내부적으로 `target_files: [train.py]`로 변환하여 동일하게 동작한다.

### Setup 실행 순서

1. **정보 수집**: 위 표의 필수 항목을 사용자에게 확인
2. **파일 읽기**: target_files(모든 대상 파일), fixed_files, context_files를 모두 읽어 전체 맥락 파악
3. **브랜치 생성**: `git checkout -b autoresearch/<tag>`
4. **results.tsv 초기화**: 헤더만 있는 파일 생성
   ```
   commit	metric	memory_gb	status	description
   ```
5. **베이스라인 측정**: target_files를 수정 없이 그대로 실행하여 첫 메트릭 기록
6. **컨텍스트 보존 시작**: `Ecompact-executor`를 백그라운드로 실행한다 (긴 루프 중 컨텍스트 윈도우 압력 자동 감지 및 스냅샷 저장)
7. **루프 진입 확인**: "Setup 완료. 자율 실험 루프를 시작합니다." 출력 후 Phase 2 진입

## Phase 2: Experiment Loop (무한 반복)

**설정 완료 후 이 루프는 사용자가 수동으로 중단할 때까지 절대 멈추지 않는다.**

```
[Background: Ecompact-executor — 컨텍스트 압력 모니터링]

LOOP FOREVER:
  1. 현재 상태 파악
  2. 가설 수립
  3. 코드 수정
  3.5. [Ecode-reviewer] 코드 리뷰 — Critical 이슈 시 수정 후 재커밋
  4. git commit
  5. 실행
  6. 결과 추출
  7. 크래시 처리 (해당 시) — [Ecode-debugger] 위임
  8. results.tsv 기록
  8.5. [매 5회] 추세 분석 — results.tsv 패턴 분석으로 가설 품질 향상
  9. 판정: keep 또는 discard
  10. 다음 아이디어 → 1로 돌아감

[On Stop: Qlesson-learned — 실험 이력에서 교훈 추출]
```

### Step 1: 현재 상태 파악

- target_files의 현재 코드를 모두 읽는다 (파일이 여러 개면 각각 읽는다)
- results.tsv에서 이전 실험 결과를 분석한다
  - 어떤 변경이 효과적이었는가?
  - 어떤 변경이 실패했는가?
  - 현재 최고 메트릭은?

### Step 2: 가설 수립

이전 결과를 바탕으로 다음 실험 가설을 세운다.

**가설 출처 우선순위:**
1. 이전 near-miss 실험의 변형 (거의 성공한 아이디어 재시도)
2. 코드에서 발견한 최적화 기회 (비효율적 패턴, 미사용 기능)
3. 하이퍼파라미터 탐색 (학습률, 배치 크기, 모델 크기 등)
4. 아키텍처 변경 (레이어 구조, 활성화 함수, 정규화 등)
5. 급진적 변경 (완전히 다른 접근법)

**진행 상황 보고:**
```
🧪 Experiment #{N}: {가설 한 줄 설명}
```

### Step 3: 코드 수정

- **target_files에 포함된 파일만 수정한다.** 목록에 없는 파일은 절대 수정하지 않는다.
- Edit 도구를 사용하여 수정한다.
- 한 실험에서 여러 파일을 동시에 수정할 수 있다 (예: model.py의 구조 변경 + train.py의 호출부 수정).
- 단, 실험 당 변경의 응집도를 유지한다 — 하나의 가설에 필요한 최소 수정만 한다.

### Step 3.5: 코드 리뷰 (Ecode-reviewer 위임)

코드 수정 후, `Ecode-reviewer` 에이전트에게 백그라운드로 리뷰를 위임한다.

```
Agent(subagent_type="qe-framework:Ecode-reviewer", run_in_background=false)
→ git diff 기반으로 수정된 코드의 정확성, 버그, 성능 이슈 검토
```

**판정 기준:**
- **Critical 이슈 발견** → 수정 후 Step 3으로 돌아가 재편집 (최대 1회)
- **Warning/Suggestion만** → 무시하고 Step 4 진행 (실험 속도 우선)
- **리뷰 타임아웃 (10초)** → 스킵하고 Step 4 진행

> 이 단계는 실험 속도와 코드 품질의 균형을 잡는다. 명백한 버그(null 참조, 무한 루프, 문법 오류)만 차단하고 스타일 이슈는 무시한다.

### Step 4: git commit

```bash
git add {target_files의 수정된 파일들}
git commit -m "experiment #{N}: {가설 설명}"
```

- `/Qcommit` 스킬을 경유하지 않는다 (자율 루프 중 스킬 중첩 방지)
- commit 메시지에 실험 번호와 가설을 포함한다

### Step 5: 실행

```bash
timeout {time_budget * timeout_multiplier} bash -c '{run_command} > run.log 2>&1'
```

- 출력은 반드시 `run.log`로 리다이렉트한다 (컨텍스트 윈도우 오염 방지)
- `timeout` 명령어로 타임아웃을 강제한다
- 실행 중 다른 작업을 하지 않는다

### Step 6: 결과 추출

```bash
{metric_grep}
```

- grep 결과에서 숫자를 파싱한다
- 숫자가 없으면 크래시로 판정 → Step 7로

**메모리 추출 (선택):**
```bash
grep "peak_vram_mb:\|peak_memory:" run.log
```

### Step 7: 크래시 처리 (Ecode-debugger 위임)

grep 결과가 비어있거나 실행이 비정상 종료된 경우:

1. `tail -n 50 run.log`으로 에러 내용 확인
2. **Ecode-debugger에 진단 위임**:
   ```
   Agent(subagent_type="qe-framework:Ecode-debugger")
   → run.log의 에러 트레이스 + target_files 코드를 전달
   → 근본 원인 분석 및 수정 제안을 반환
   ```
3. **단순 오류** (타이포, 임포트 누락, 문법 오류): Ecode-debugger의 제안을 반영하여 수정 후 Step 5 재실행 (최대 2회 재시도)
4. **근본적 문제** (OOM, 로직 오류, 호환성): Ecode-debugger가 "근본적"으로 판정하거나 2회 재시도 후에도 실패 시 → crash로 기록
5. git reset으로 원래 상태 복원

> Ecode-debugger는 읽기 전용 에이전트로, 진단과 제안만 반환한다. 실제 수정은 Qautoresearch가 직접 수행한다.

### Step 8: results.tsv 기록

실험 결과를 탭 구분으로 기록한다:

```
{commit_hash_7char}	{metric_value}	{memory_gb}	{status}	{description}
```

| 필드 | 설명 |
|------|------|
| commit | git commit hash (7자리) |
| metric | 메트릭 값 (크래시 시 0.000000) |
| memory_gb | 피크 메모리 GB (없으면 0.0) |
| status | `keep`, `discard`, `crash` |
| description | 실험 가설 한 줄 설명 |

**results.tsv는 git에 commit하지 않는다** (untracked 유지).

### Step 8.5: 추세 분석 (매 5회 실험마다)

실험 번호가 5의 배수일 때, results.tsv를 분석하여 가설 수립 품질을 높인다.

**분석 항목:**
- **성공률**: keep / total 비율 → 10% 미만이면 접근 방향 전환 필요
- **메트릭 추세**: 최근 5회의 메트릭 변화 방향 → 정체 시 급진적 변경 시도
- **크래시 패턴**: 반복되는 에러 유형 → 해당 방향의 가설 회피
- **최고 성과 실험**: 어떤 종류의 변경이 가장 효과적이었는지 패턴 추출

**분석 방법:**
```
results.tsv를 직접 읽고, 위 항목을 내부적으로 계산한다.
별도 도구 호출 없이 텍스트 파싱으로 처리한다 (컨텍스트 효율).
```

**분석 결과 활용:**
- Step 2 가설 수립 시 "가설 출처 우선순위"를 동적으로 재조정
- 성공률 높은 변경 유형에 가중치 부여
- 3회 연속 crash한 방향은 블랙리스트 처리

> 매 실험마다 분석하면 토큰 낭비. 5회 단위가 속도와 학습의 균형점.

### Step 9: 판정 — keep 또는 discard

**metric_direction = lower_is_better:**
- 메트릭이 현재 최저값보다 낮음 → **keep** (브랜치 advance)
- 메트릭이 동일 또는 높음 → **discard** (`git reset --hard HEAD~1`)

**metric_direction = higher_is_better:**
- 메트릭이 현재 최고값보다 높음 → **keep**
- 메트릭이 동일 또는 낮음 → **discard** (`git reset --hard HEAD~1`)

**단순성 기준 (Simplicity Criterion):**
- 메트릭이 미미하게 개선 (< 0.1% 변화) + 코드 복잡성 증가 (20줄+ 추가) → **discard**
- 메트릭이 동일하지만 코드가 더 단순해짐 (줄 수 감소) → **keep**
- 코드를 삭제했는데 메트릭이 동일 또는 개선 → **keep** (단순화 승리)

**판정 보고:**
```
✅ Experiment #{N}: KEEP — metric {이전} → {현재} ({변화량})
❌ Experiment #{N}: DISCARD — metric {이전} → {현재} (no improvement)
💥 Experiment #{N}: CRASH — {에러 요약}
```

### Step 10: 다음 아이디어

- 이전 결과를 분석하여 다음 가설을 구상한다
- **아이디어가 고갈되었다고 느껴도 멈추지 않는다:**
  - target_files를 처음부터 다시 읽는다
  - context_files와 fixed_files를 다시 참조한다
  - 이전 near-miss 실험을 조합한다
  - 더 급진적인 아키텍처 변경을 시도한다
  - 반대 방향의 변경을 시도한다 (이전에 증가시켰으면 감소)
- Step 1로 돌아간다

## Phase 3: Wrap-up (사용자가 루프를 중단했을 때)

사용자가 수동으로 루프를 중단하면 자동으로 실행한다.

### 1. 최종 결과 요약
```
📊 Autoresearch Session: {tag}
   Total experiments: {N}
   Keep: {count} | Discard: {count} | Crash: {count}
   Best metric: {value} (experiment #{best_n})
   Branch: autoresearch/{tag}
```

### 2. 교훈 추출 (Qlesson-learned 패턴 적용)
`autoresearch/<tag>` 브랜치의 git 이력을 분석하여 교훈을 추출한다:
- 어떤 유형의 변경이 가장 효과적이었는가?
- 어떤 방향이 반복적으로 실패했는가?
- 발견된 코드 최적화 패턴은?

결과를 `autoresearch-lessons-{tag}.md`로 저장한다.

### 3. 브랜치 안내
```
💡 변경사항을 메인 브랜치에 반영하려면:
   git checkout main && git merge autoresearch/{tag}
```

## Dependencies

이 스킬은 아래 에이전트/스킬에 의존한다. 모두 QE Framework 내장이므로 별도 설치 불필요.

| 의존 대상 | 유형 | 연결 지점 | 호출 방식 | 필수 여부 |
|-----------|------|-----------|-----------|-----------|
| **Ecompact-executor** | Agent | Phase 1 Setup → Phase 2 전체 | 백그라운드 (`run_in_background=true`) | 권장 |
| **Ecode-reviewer** | Agent | Step 3.5 코드 리뷰 | 포그라운드 (10초 타임아웃) | 권장 |
| **Ecode-debugger** | Agent | Step 7 크래시 처리 | 포그라운드 (크래시 시에만) | 권장 |
| **Qlesson-learned** | Skill 패턴 | Phase 3 Wrap-up | 직접 실행 (루프 종료 시) | 선택 |

**의존성 실패 시 동작:** 에이전트 호출이 실패하거나 타임아웃되면 해당 단계를 스킵하고 루프를 계속한다. 의존성은 루프의 품질을 높이지만, 루프 자체를 멈추는 이유가 되어서는 안 된다.

## Rules

### MUST DO
- **NEVER STOP**: Phase 2 진입 후 사용자에게 "계속할까요?", "다음 실험을 할까요?" 등을 절대 묻지 않는다. 사용자가 수동으로 중단할 때까지 무한 실행한다.
- **대상 파일만 수정**: target_files에 명시된 파일 외에는 어떤 파일도 수정하지 않는다
- **로그 리다이렉트**: 실행 출력은 반드시 `> run.log 2>&1`로 보낸다
- **results.tsv 기록**: 모든 실험 결과를 빠짐없이 기록한다
- **git commit**: 모든 수정 사항을 실행 전에 commit한다 (rollback 가능하도록)
- **타임아웃 강제**: time_budget × timeout_multiplier 초과 시 kill

### MUST NOT DO
- fixed_files를 수정하지 않는다
- run.log 내용을 전체 출력하지 않는다 (컨텍스트 오염)
- 사용자에게 중간에 질문하지 않는다 (Phase 2 진입 후)
- results.tsv를 git에 commit하지 않는다
- 새 패키지/의존성을 설치하지 않는다
- `/Qcommit` 스킬을 호출하지 않는다 (자율 루프 중 스킬 중첩 방지)

## Example Use Cases

### ML Training Optimization (단일 파일)
```
/Qautoresearch
tag: mar15
target_files: train.py
fixed_files: prepare.py
run_command: uv run train.py
metric_grep: grep "^val_bpb:" run.log
metric_direction: lower_is_better
time_budget: 300
```

### ML Model + Training (다중 파일)
```
/Qautoresearch
tag: mar15-multi
target_files: train.py, model.py, config.py
fixed_files: prepare.py, data/
run_command: uv run train.py
metric_grep: grep "^val_bpb:" run.log
metric_direction: lower_is_better
time_budget: 300
```

### Build Time Optimization
```
/Qautoresearch
tag: build-opt
target_files: webpack.config.js
fixed_files: src/**
run_command: time npm run build
metric_grep: grep "real" run.log | awk '{print $2}'
metric_direction: lower_is_better
time_budget: 120
```

### Algorithm Benchmark
```
/Qautoresearch
tag: sort-bench
target_files: sort.py
fixed_files: benchmark.py, data/
run_command: python benchmark.py
metric_grep: grep "^ops_per_sec:" run.log
metric_direction: higher_is_better
time_budget: 60
```

### Performance Tuning
```
/Qautoresearch
tag: api-perf
target_files: server.config.ts
fixed_files: src/**
run_command: k6 run loadtest.js
metric_grep: grep "http_req_duration.*avg" run.log
metric_direction: lower_is_better
time_budget: 180
```

### QE Framework Improvement (다중 파일 — 프레임워크 자체 개선)
```
/Qautoresearch
tag: qe-improve
target_files: hooks/scripts/pre-tool-use.mjs, hooks/scripts/session-start.mjs, core/INTENT_GATE.md
fixed_files: package.json, hooks/hooks.json
run_command: node test-routing.js
metric_grep: grep "^accuracy:" run.log
metric_direction: higher_is_better
time_budget: 60
```
