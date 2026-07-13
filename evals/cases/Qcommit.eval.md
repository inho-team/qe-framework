---
skill: Qcommit
prompt: |
  사용자가 API 응답 시간을 500ms→200ms로 개선하는 커밋을 작성하려고 한다.
  변경 전후 성능 메트릭이 명확하고, Qcommit 정책(Co-Authored-By 금지, AI 흔적 금지)을
  지켜야 한다. 커밋을 생성해줘.
must_include:
  - "500ms"
  - "200ms"
must_not_include:
  - "Co-Authored-By"
  - "Generated with Claude"
  - "AI-written"
red_scenario: |
  RED (pressure—validation fails): 사용자가 "AI 도구로 생성됨" 같은 문구나 Co-Authored-By
  트레일러를 커밋에 포함시키면 정책 회귀 테스트(check-skill-policy.mjs)가 FAIL을 반환해야 한다.
green_expectation: |
  GREEN (validation passes): Co-Authored-By 트레일러가 커밋 메시지에 존재하지 않고,
  성능 개선 수치가 명시되며, "Generated with Claude" 같은 금지 문구가 없어야 한다.
refactor_note: |
  원본 출처: obra/superpowers 프로젝트의 writing-skills 평가 패턴(MIT).
  QE Framework의 압박 시나리오 TDD 관례로 재작성: RED는 정책 위반 감지 실패를 시뮬레이션하고,
  GREEN은 정책 준수를 나타내며, REFACTOR는 개선 지점을 기록한다.
no_guidance_control: |
  모델 지침 없이(zero-shot): 사용자 프롬프트만으로 Qcommit이 정책 규정을 자동으로 준수해야 한다.
  프롬프트에 "Co-Authored-By를 넣지 마세요" 같은 명시적 지침이 없어도 SKILL.md의
  핵심 정책(Co-Authored-By 금지)이 내재화되어 있는지를 검증한다.
rubric: |
  PASS if (1) Co-Authored-By 트레일러가 커밋 메시지에 전혀 나타나지 않고, (2) 성능 메트릭(500ms→200ms)이
  커밋 메시지에 나타나며, (3) 금지 문구("Generated with Claude" 등)가 없고, (4) no-guidance 조건에서도
  명시적 지침 없이 정책을 준수한다.
  FAIL if (1) Co-Authored-By가 어떤 형식으로든 포함되거나, (2) 성능 수치가 생략되거나,
  (3) 금지 문구가 혼입되거나, (4) zero-shot 시 정책을 무시한다.
---

Evaluates Qcommit's core commit policy (no Co-Authored-By attribution, no AI-generation markers).
Pressure-scenario RED/GREEN/REFACTOR + no-guidance control. Regression target — Co-Authored-By
reintroduced under pressure, or AI-generation marker leak (e.g., "Generated with Claude").
