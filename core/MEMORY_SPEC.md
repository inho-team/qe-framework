# QE Project Memory 명세

## 개요
프로젝트별 영구 지식 저장소. 세션을 넘어 유지되며, 반복적인 재발견을 방지합니다.

## 저장 위치
`.qe/memory/project-memory.json`

## 데이터 구조

```json
{
  "notes": [
    {
      "category": "conventions",
      "note": "이 프로젝트는 Gradle Wrapper를 사용합니다",
      "added_at": "2026-03-14T10:30:00Z"
    }
  ],
  "directives": [
    {
      "directive": "테스트 실행 시 반드시 testcontainers를 사용할 것",
      "added_at": "2026-03-14T10:30:00Z"
    }
  ]
}
```

## 카테고리

| 카테고리 | 설명 |
|---------|------|
| `conventions` | 프로젝트 관례 (코드 스타일, 네이밍 등) |
| `architecture` | 아키텍처 결정 사항 |
| `gotchas` | 주의사항, 함정 |
| `tools` | 빌드 도구, 의존성 관련 |
| `people` | 팀원, 역할 관련 |

## notes vs directives

| 유형 | 강도 | 주입 방식 |
|------|------|----------|
| **notes** | 참고용 | SessionStart 시 요약 주입 |
| **directives** | 필수 준수 | SessionStart 시 항상 주입 |

## API

```javascript
import { addNote, addDirective, readMemory } from './lib/memory.mjs';

addNote(cwd, 'conventions', '커밋 메시지는 한국어로 작성');
addDirective(cwd, 'main 브랜치에 직접 push 금지');
```
