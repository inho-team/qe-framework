---
name: Qskill-creator
description: "새로운 스킬 생성, 기존 스킬 수정/개선, 스킬 성능 측정. 스킬을 처음부터 만들거나 편집/최적화/평가/벤치마크할 때 사용."
metadata:
  source: https://skills.sh/anthropics/skills/skill-creator
  author: anthropic
---

# Skill Creator

## 스킬 생성 프로세스
1. 목적과 방법 결정
2. 초안 작성
3. 테스트 프롬프트로 실행
4. 정성적/정량적 평가
5. 피드백 기반 재작성
6. 반복
7. 테스트셋 확장

## SKILL.md 형식
```markdown
---
name: skill-name
description: 트리거 조건 포함 설명
---
# 스킬 제목
내용...
```

## Description 가이드
- 언제 트리거할지 명확히
- 구체적 예시 ("사용자가 X를 요청할 때")
- 부정적 트리거 ("Y일 때는 사용 안 함")

## 설치 위치
- 전역: `~/.claude/skills/<name>/SKILL.md`
- 로컬: `.claude/skills/<name>/SKILL.md`
