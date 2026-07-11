# Contract: config

QE framework 설정 로더. 기본값(상태 유효기간, 분석 신선도, 에러 추적, 프로파일링 간격 등)을 정의하고, `.qe/config.json` 프로젝트 override로 병합. hooks와 skills가 의존하는 단일 진입점.

## Signature

```ts
interface ConfigObject {
  // state.mjs
  stale_ms: number;
  analysis_freshness_ms: number;
  // session-start.mjs — background analysis auto-refresh
  auto_refresh_enabled: boolean;
  auto_refresh_model: string;
  auto_refresh_interval_ms: number;
  auto_refresh_lock_ttl_ms: number;
  // post-tool-use.mjs
  error_window_ms: number;
  error_escalate_count: number;
  error_delegate_count: number;
  // post-tool-use.mjs — docs collection interval
  docs_collect_interval: number;
  // stop-handler.mjs
  max_reinforcements: number;
  session_log_max: number;
  satisfaction_enabled: boolean;
  sweep_auto: boolean;
  style_gate: boolean;
  style_gate_max_blocks: number;
  style_gate_window_ms: number;
  code_risk_stop_gate: boolean;
  verification_evidence_gate: 'warn' | 'block' | false;
  hook_profile: 'minimal' | 'safe' | 'full';
  // pre-tool-use.mjs
  context_pressure_high: number;
  context_pressure_warn: number;
  // prompt-check.mjs
  intent_confidence_threshold: number;
  ambiguous_max_words: number;
  ambiguous_max_chars: number;
}

export function loadConfig(cwd: string | undefined): ConfigObject;
export const DEFAULTS: ConfigObject;
```

## Purpose

`loadConfig(cwd)`는 주어진 working directory의 `.qe/config.json`에서 프로젝트 override를 읽어 기본값과 병합한 설정 객체를 반환. hooks와 skills 전체가 런타임 동작(재시도 간격, 압축 임계값, 만족도 확인 등)을 조정하기 위해 이 객체에 의존.

## Constraints

- config 파일 경로: `<cwd>/.qe/config.json` 고정
- 파일 부재 시: 기본값만 사용 (에러 없음, silent fallback)
- JSON 파싱 실패 시: 기본값만 사용 (catch 블록에서 silent)
- override 병합: `overrides.hooks` 필드만 config에 assign (다른 필드 무시)
- cwd가 falsy (undefined, null, 빈 문자열): DEFAULTS 반환 (파일 검색 안 함)
- 환경 변수: 읽지 않음 (파일 기반만)
- 캐싱: 없음 (매 호출마다 파일 재읽음)

## Invariants

- `loadConfig()`는 항상 object를 반환 (never null, never undefined)
- 반환 object는 최소한 DEFAULTS의 모든 키를 가짐
- 같은 cwd로 반복 호출 시 동일한 object 값 반환 (멱등성) — 객체 id는 다를 수 있음
- 모든 config 값은 원래 타입 유지: number 필드는 number, boolean은 boolean
- override에 존재하지 않는 기본값 필드는 그대로 유지 (기본값 소실 없음)

## Error Modes

```ts
// loadConfig is total — never throws.
// Missing .qe/config.json → return DEFAULTS
// Malformed JSON in .qe/config.json → catch block, return DEFAULTS
// Invalid cwd (null, undefined, empty) → return DEFAULTS
// No errors thrown; all paths return valid ConfigObject
never: Error;
```

<!-- tests: hooks/scripts/lib/__tests__/config.test.mjs (if created) -->

## Notes

- `.qe/config.json` 포맷: `{ "hooks": { "stale_ms": 7200000, ... } }`
- readFileSync/existsSync는 blocking I/O — 따라서 hooks 초기화 시 (비동기 context 외) 호출 권장
- DEFAULTS 값들은 상수 정의(주석 포함) 참조 — 변경 시 DEFAULTS와 구현 모두 갱신 필요
- Signature synced to implementation on 2026-07-11 (task cc64ea5e): removed phantom `profile_collect_interval` (never existed in DEFAULTS); added `auto_refresh_*`, `sweep_auto`, `style_gate`, `style_gate_max_blocks`, `style_gate_window_ms`, `code_risk_stop_gate`, `hook_profile`, and `verification_evidence_gate`
