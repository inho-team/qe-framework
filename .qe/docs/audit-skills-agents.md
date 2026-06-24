# 스킬·에이전트 정합성 검증 보고서

- **Task**: TASK_REQUEST_24783692
- **Date**: 2026-06-24
- **Scope**: skills/ (182 SKILL.md) + agents/ (25 *.md) = 207 파일
- **방식**: 기계적 스캔 우선(4차원 스크립트 일괄) → 의심 항목만 정독 확정
- **결론**: 실결함 **1 클러스터(10건, important)** — 죽은 reference 링크. 그 외 경로/frontmatter/등록/교차참조/회귀 **전부 정상**.

---

## 종합 판정

| 차원 | 스캔 raw | 오탐 | **실결함** | 상태 |
|------|---------|------|-----------|------|
| 1. 경로/참조 무결성 | 12 | 12 | 0 | ✅ |
| 1b. 마크다운 링크(.md/.mjs/.json) | 10 | 0 | **10** | ❌ important |
| 2. frontmatter·등록 | 0 | 0 | 0 | ✅ |
| 3. 교차참조(skill/agent) | 32 | 32 | 0 | ✅ |
| 4. 내용 정합성(도구·hook·회귀) | 0 | 0 | 0 | ✅ |

---

## 실결함 (수정 권고)

### F1 — 죽은 reference 링크 10건 (severity: important)
두 스킬이 본문에서 deep-dive 문서를 링크하지만 `references/` 디렉터리가 **존재하지 않음**. 스킬은 SKILL.md 본문만으로 동작하므로 치명적이진 않으나, 약속한 상세 문서가 전부 dead link → progressive-disclosure 깨짐(사용자·에이전트가 더 읽으려 하면 실패).

**skills/Qmermaid-diagrams/SKILL.md** — `## Detailed References` (7건)
| 라인 | 죽은 링크 |
|------|-----------|
| 116 | references/class-diagrams.md |
| 117 | references/sequence-diagrams.md |
| 118 | references/flowcharts.md |
| 119 | references/erd-diagrams.md |
| 120 | references/c4-diagrams.md |
| 121 | references/architecture-diagrams.md |
| 122 | references/advanced-features.md |

**skills/Qc4-architecture/SKILL.md** — `## References` (3건)
| 라인 | 죽은 링크 |
|------|-----------|
| 192 | references/c4-syntax.md |
| 193 | references/common-mistakes.md |
| 194 | references/advanced-patterns.md |

**권고 (택1):**
- (A) `references/*.md` 10개를 실제 작성 — 링크 설명문대로 내용 채움. 가치 보존, 작업량 큼.
- (B) 두 "References" 섹션을 제거하거나 인라인 요약으로 대체 — 빠름, dead link 즉시 해소. **(권장: 최소 수정)**
- 두 스킬 다 `references`(복수형) 사용. 다른 스킬들은 `reference`(단수형, 예: Qcritical-review)를 쓰며 그쪽은 모두 실재 → 명명 불일치는 부차적.

---

## 오탐 기록 (참고 — 결함 아님)

스캐너 정규식이 더 긴 정상 경로/표 셀을 부분 매칭한 케이스. 모두 실재 확인 후 기각:

- **D1 (12건)**: `reference/*.md`·`scripts/*.mjs`·`templates/*`가 실제로는 `skills/Qcritical-review/reference/...`, `hooks/scripts/...`, `core/wiki-templates/...`로 정상 존재. 정규식이 prefix를 놓침.
- **D3 (32건)**: `/Q2`·`/Q3`·`/Q4`(분기), `/MAJOR`·`/MINOR`·`/Medium`·`/Monthly`·`/Major`·`/Med`·`/Modal`·`/Miro`·`/Messaging`·`/MetricCard`·`/Quickstart`·`/MSYS`·`/QR` 등 — 표 셀·파일명·헤딩 내 슬래시. 스킬 참조 아님.
- `/Qrt`, `/Qgs` = 문서화된 alias(각각 Qrun-task/Qgenerate-spec), `/Qname`·`/Ename` = Mcreate-skill/agent 템플릿 placeholder. 정상.
- **D2 placeholder**: `hooks/scripts/lib/foo.mjs`(Qcontract) = 예시. 정상.

---

## 검증된 정상 항목 (강조)

- **frontmatter**: 207개 전부 `name`+`description` 보유, name↔디렉터리/파일명 일치, 중복 name 0.
- **등록 일치**: plugin.json `agents[]`(25) ↔ agents/ 실파일 25 양방향 완전 일치(고아·누락 0).
- **subagent_type**: 모든 위임 참조가 실재 에이전트(또는 네임스페이스/빌트인)로 해소.
- **회귀 가드 ★★★**: 직전 수정한 `node -e` plugin-root fallback 강화 — 잔존 stale 패턴(`CLAUDE_PLUGIN_ROOT||~/.claude`) **0건**. 5개 스킬 전부 강화 resolver 적용 확인.
- **에이전트 tools**: 미인식 도구명 0.

---

## 한계·후속

- 차원 4의 "설명↔실제 동작 의미 일치"는 기계 스캔 우선 방침에 따라 **회귀·도구·hook명 등 검증 가능한 것만** 다뤘다. 각 스킬 지시문의 의미적 정확성(예: 절차가 실제로 의도대로 동작하는지)까지의 207-파일 LLM 정독은 별도 task(`기계적+LLM 하이브리드`) 필요 시 수행.
- 본 보고서는 읽기 전용 분석 — 스킬/에이전트 원본 **미수정**. F1 실제 수정은 별도 task로.
