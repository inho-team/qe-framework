# Coding Experts — Shared Principles

코딩 expert 스킬 전체에 적용되는 공통 원칙. 개별 스킬의 SKILL.md보다 이 문서가 우선한다.

## Context7 — 최신 문서 참조

코드를 생성하기 전, Context7 MCP가 사용 가능하면 해당 라이브러리의 최신 문서를 확인한다.

### 왜?

- LLM 학습 데이터는 특정 시점에 고정됨 → 구버전 API를 환각할 수 있음
- Context7은 공식 문서에서 최신 코드 예시를 실시간으로 가져옴
- 메서드 시그니처, import 경로, 디폴트 값이 정확해짐

### 규칙

1. **코드 생성 전 확인**: 라이브러리/프레임워크 코드를 작성할 때, Context7 MCP 도구(`resolve-library-id`, `get-library-docs`)가 사용 가능하면 해당 라이브러리 문서를 먼저 조회한다
2. **사용 불가 시 무시**: Context7 MCP가 설정되지 않은 환경에서는 이 규칙을 건너뛴다. 에러를 내거나 사용자에게 설치를 강요하지 않는다
3. **캐시 활용**: 같은 대화 내에서 이미 조회한 라이브러리는 재조회하지 않는다
4. **적용 범위**: 외부 라이브러리 API를 사용하는 코드에만 적용. 프로젝트 내부 코드나 표준 라이브러리는 대상 아님

### Context7 MCP 설정 (선택)

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {
        "DEFAULT_MINIMUM_TOKENS": "10000"
      }
    }
  }
}
```

> API Key는 선택사항. 없어도 동작하나, 높은 rate limit이 필요하면 [context7.com/dashboard](https://context7.com/dashboard)에서 발급.

### 사용 흐름

```
1. 사용자가 "React 19로 form 만들어줘" 요청
2. Context7 MCP 사용 가능 여부 확인
3. 가능하면 → resolve-library-id("react") → get-library-docs(id)
4. 최신 문서 기반으로 코드 생성
5. 불가능하면 → 기존 지식 기반으로 코드 생성
```

## 코드 품질 기본 원칙

1. **동작하는 코드 우선** — 컴파일/실행 가능한 코드를 작성한다
2. **최소 변경** — 요청된 것만 변경한다. 주변 코드를 건드리지 않는다
3. **프로젝트 관례 준수** — 기존 코드의 네이밍, 포맷, 구조를 따른다
4. **타입 안전성** — 타입이 있는 언어에서는 `any` 사용을 최소화한다
5. **에러 핸들링** — 시스템 경계(사용자 입력, 외부 API)에서만 검증한다
