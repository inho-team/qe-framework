---
name: Qskill-tester
description: "Automated skill/agent routing tester. Generates virtual user prompts, simulates intent classification, and verifies that the correct skill or agent is triggered. Use when auditing skill descriptions, validating intent routing accuracy, or after adding/modifying skills. Finds misrouted, unreachable, or conflicting skills and suggests fixes."
metadata:
  version: "1.0.0"
  domain: quality
  triggers: test skills, skill test, routing test, verify skills, audit routing, skill tester, 스킬 테스트
  role: specialist
  scope: analysis
  output-format: report
  related-skills: Qskill-creator, Qfind-skills
keywords: skill test, intent routing, trigger verification, self-improvement, quality assurance
---

# Skill Tester — 스킬 라우팅 자동 검증

모든 스킬/에이전트의 트리거가 올바르게 작동하는지 자동 검증하고, 오분류를 찾아 수정한다.

## 워크플로우

```
1. 스킬 수집 → 2. 테스트 케이스 생성 → 3. 라우팅 시뮬레이션 → 4. 판정 → 5. 수정 제안 → 6. 재검증
```

## Step 1: 스킬 수집

프로젝트 내 모든 스킬과 에이전트를 수집한다.

```bash
# 스킬 목록
find skills/ -name "SKILL.md" | sort

# 에이전트 목록
find agents/ -name "*.md" | sort

# 인텐트 라우트 설정
cat hooks/scripts/lib/intent-routes.json
```

각 스킬에서 추출할 정보:
- `name`: 스킬 이름
- `description`: 설명 (트리거 조건 포함)
- `triggers`: 메타데이터의 트리거 키워드
- `keywords`: 추가 키워드

## Step 2: 테스트 케이스 생성

스킬별로 **3가지 유형**의 가상 프롬프트를 생성한다:

### A. 정상 호출 (이 스킬이 호출돼야 함)
```markdown
| 스킬 | 테스트 프롬프트 | 기대 결과 |
|------|----------------|-----------|
| Qreact-expert | "React 컴포넌트 만들어줘" | Qreact-expert |
| Qfact-checker | "이 보고서 팩트체크해줘" | Qfact-checker |
| Qdoc-converter | "이 마크다운을 워드로 변환해" | Qdoc-converter |
```

### B. 경계 케이스 (유사 스킬 간 구분)
```markdown
| 테스트 프롬프트 | 기대 결과 | 오분류 위험 |
|----------------|-----------|-------------|
| "UI 디자인 만들어줘" | Qfrontend-design | Qweb-design-guidelines |
| "버그 원인 찾아줘" | Qsystematic-debugging | Ecode-debugger |
| "테스트 먼저 작성하자" | Qtest-driven-development | Ecode-test-engineer |
```

### C. 미등록 프롬프트 (라우트 없는 경우)
```markdown
| 테스트 프롬프트 | 기대 결과 |
|----------------|-----------|
| "jira 이슈 만들어" | Qjira-cli (또는 Qatlassian-mcp) |
| "출처 검증해줘" | Qsource-verifier |
| "글 쓰는 거 도와줘" | Qcontent-research-writer |
```

## Step 3: 라우팅 시뮬레이션

`intent-routes.json`의 라우팅 로직을 시뮬레이션한다.

### 매칭 알고리즘 (prompt-check.mjs 동일)

```javascript
function simulateRouting(userMessage, routes) {
  const msgLower = userMessage.toLowerCase();
  const msgWords = msgLower.split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;

  for (const [keywords, target] of Object.entries(routes)) {
    const parts = keywords.split('/');
    let matchedParts = 0;
    let totalWeight = 0;

    for (const part of parts) {
      const term = part.toLowerCase().replace(/-/g, ' ');
      const termWords = term.split(/\s+/);

      const hasExactWord = termWords.some(tw => msgWords.includes(tw));
      const hasSubstring = msgLower.includes(term);

      if (hasExactWord) {
        matchedParts++;
        totalWeight += term.length * 2;
      } else if (hasSubstring) {
        matchedParts++;
        totalWeight += term.length;
      }
    }

    const score = matchedParts > 0 ? matchedParts * 3 + totalWeight : 0;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { intent: keywords, routed_to: target, score };
    }
  }

  return bestMatch;
}
```

### 실행 방법

각 테스트 프롬프트에 대해:
1. `simulateRouting(prompt, routes)`를 실행
2. 결과와 기대값을 비교
3. 불일치 시 기록

## Step 4: 판정

### 결과 분류

| 판정 | 의미 |
|------|------|
| **PASS** | 기대 스킬로 정확히 라우팅됨 |
| **MISROUTE** | 다른 스킬로 잘못 라우팅됨 |
| **UNREACHABLE** | intent-routes.json에 등록되지 않아 라우팅 불가 |
| **CONFLICT** | 2개 이상 스킬이 동일 점수로 경합 |
| **WEAK** | 라우팅되지만 점수가 낮아 불안정 |

### 판정 기준

```
score >= threshold × 2  → PASS (강한 매칭)
score >= threshold      → PASS (약한 매칭) — WEAK 경고 부여
score < threshold       → UNREACHABLE
기대 ≠ 실제            → MISROUTE
```

## Step 5: 보고서 작성

### 테스트 결과 보고서

```markdown
# 스킬 라우팅 테스트 보고서

**실행일:** [날짜]
**총 테스트:** N개
**PASS:** N개 | **MISROUTE:** N개 | **UNREACHABLE:** N개 | **CONFLICT:** N개

## MISROUTE (즉시 수정 필요)

| 프롬프트 | 기대 | 실제 | 점수 | 원인 분석 |
|----------|------|------|------|-----------|
| "..." | Qfrontend-design | Qweb-design-guidelines | 12 | triggers에 "UI" 키워드 경합 |

## UNREACHABLE (라우트 등록 필요)

| 스킬 | 등록 여부 | 제안 라우트 키워드 |
|------|-----------|-------------------|
| Qjira-cli | 미등록 | "jira/issue/ticket/sprint" |

## CONFLICT (우선순위 조정 필요)

| 프롬프트 | 경합 스킬 | 점수 |
|----------|-----------|------|
| "..." | SkillA (12) vs SkillB (12) | 동점 |

## WEAK (불안정 매칭)

| 프롬프트 | 스킬 | 점수 | 위험도 |
|----------|------|------|--------|
| "..." | Qfact-checker | 4 | 약간의 프롬프트 변형으로 오분류 가능 |

## 커버리지

| 카테고리 | 등록 스킬 | 미등록 스킬 | 커버리지 |
|----------|-----------|-------------|----------|
| 일반 스킬 | 28/32 | 4 | 87.5% |
| 코딩 expert | N/A | N/A | 별도 트리거 |
| 에이전트 | 5/16 | 11 | 31.3% |
```

## Step 6: 자동 수정 제안

### MISROUTE 수정

```markdown
### 수정 제안: [스킬명]

**문제:** "[프롬프트]"가 [잘못된 스킬]로 라우팅됨
**원인:** description에 "[키워드]"가 없거나, intent-routes.json에서 키워드 경합

**수정안 A — description 수정:**
기존: "..."
수정: "... Use when [구체적 트리거]..."

**수정안 B — intent-routes.json 수정:**
기존: "keyword1/keyword2" → "SkillA"
수정: "keyword1/keyword2/keyword3" → "SkillA"  (차별 키워드 추가)
```

### UNREACHABLE 수정

```markdown
### 수정 제안: intent-routes.json에 추가

추가할 라우트:
  "jira/issue/ticket/sprint": "Qjira-cli",
  "fact-check/verify-claims/accuracy": "Qfact-checker",
  "source/credibility/SIFT": "Qsource-verifier",
  "convert/md-to-docx/format": "Qdoc-converter",
  "content-writing/article/draft": "Qcontent-research-writer"
```

### 재검증

수정 적용 후 동일 테스트를 재실행하여 PASS 확인.

## 실행 모드

### 빠른 검증 (기본)

```
/Qskill-tester
```

- intent-routes.json에 등록된 스킬만 검증
- 스킬당 테스트 프롬프트 2개 자동 생성
- MISROUTE/UNREACHABLE만 보고

### 전체 검증

```
/Qskill-tester --full
```

- 모든 스킬/에이전트 검증 (coding-experts 포함)
- 스킬당 테스트 프롬프트 5개 (정상 3 + 경계 2)
- 전체 보고서 + 수정 제안 + 자동 수정 여부 확인

### 특정 스킬 검증

```
/Qskill-tester Qfact-checker Qsource-verifier
```

- 지정 스킬만 집중 검증

## 실행 규칙

### MUST DO
- intent-routes.json과 실제 스킬 목록을 교차 검증한다
- 유사 스킬 간 경계 케이스를 반드시 테스트한다
- 수정 제안 시 기존 라우팅에 영향 없는지 회귀 확인한다
- 수정 적용 전 사용자 확인을 받는다

### MUST NOT DO
- 테스트 없이 description을 수정하지 않는다
- intent-routes.json을 사용자 확인 없이 변경하지 않는다
- coding-experts 스킬의 description을 변경하지 않는다 (트리거 방식이 다름)
- 테스트 케이스에 실제 사용자 데이터를 사용하지 않는다
