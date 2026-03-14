# QE State Management 명세

## 상태 저장 구조

```
.qe/state/
├── {mode}-state.json              ← 레거시 (세션 미지정 시)
└── sessions/
    └── {sessionId}/
        └── {mode}-state.json      ← 세션 격리
```

## 상태 파일 형식

```json
{
  "active": true,
  "started_at": "ISO 타임스탬프",
  "updated_at": "ISO 타임스탬프",
  "session_id": "세션 UUID",
  "reinforcement_count": 0,
  "max_reinforcements": 20,
  "original_prompt": "사용자 원본 요청"
}
```

## 핵심 규칙

### Atomic Write
- 임시 파일에 먼저 쓰고, rename으로 교체
- 부분 쓰기로 인한 파일 손상 방지

### Session 격리
- sessionId가 있으면 `sessions/{sessionId}/` 하위에 저장
- sessionId가 없으면 레거시 경로 사용
- 읽기 시 세션 경로 → 레거시 경로 순으로 폴백

### Staleness Guard
- 2시간(7,200,000ms) 이상 경과한 상태는 비활성으로 간주
- 좀비 상태가 새 세션을 블로킹하는 것을 방지

### Reinforcement 제한
- 각 모드에 max_reinforcements 설정 (기본 20)
- Stop 훅에서 reinforcement_count가 max에 도달하면 블로킹 해제
- 무한 루프 방지

## 사용 가능한 모드

| 모드 | 설명 | Stop 블로킹 |
|------|------|------------|
| qrun-task | 작업 실행 중 | 예 |
| qrefresh | 분석 갱신 중 | 예 |
| qarchive | 아카이브 중 | 예 |

## API

```javascript
import { readState, writeState, clearState, listActiveModes } from './lib/state.mjs';

// 읽기
const state = readState(cwd, 'qrun-task', sessionId);

// 쓰기
writeState(cwd, 'qrun-task', { original_prompt: '...' }, sessionId);

// 삭제
clearState(cwd, 'qrun-task', sessionId);

// 활성 모드 목록
const modes = listActiveModes(cwd, sessionId);
```
