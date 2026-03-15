---
name: Qsource-verifier
description: "Verifies source credibility and digital content authenticity. Use when checking source reliability, investigating social media accounts, verifying images/videos/documents, or building verification trails for claims and evidence."
metadata:
  source: https://github.com/jamditis/claude-skills-journalism
  author: jamditis
  version: "1.0.0"
  domain: writing
  triggers: verify source, check credibility, is this reliable, source check, verify image, verify document, SIFT, verification trail
  role: specialist
  scope: analysis
  output-format: report
  related-skills: Qfact-checker, Qcontent-research-writer
keywords: source verification, credibility, SIFT, digital verification, image verification, document verification
---

# Source Verifier — 출처 검증 방법론

출처의 신뢰성과 디지털 콘텐츠의 진위를 체계적으로 검증한다.

## SIFT 방법론

| 단계 | 행동 | 설명 |
|------|------|------|
| **S** — Stop | 멈추기 | 검증 전 공유하거나 인용하지 않는다 |
| **I** — Investigate | 출처 조사 | 정보 뒤에 누가 있는가? |
| **F** — Find | 다른 보도 찾기 | 다른 신뢰 출처는 뭐라 하는가? |
| **T** — Trace | 원본 추적 | 주장의 최초 출처를 찾는다 |

## 출처 신뢰도 평가

### 평가 템플릿

```markdown
## 출처 평가: [출처명]

### 기본 식별
- [ ] 실명/조직명 확인됨
- [ ] 연락처 검증 가능
- [ ] 전문 자격 확인 가능
- [ ] 온라인 프레즌스가 플랫폼 간 일관됨

### 전문성 평가
- [ ] 해당 주장에 관련된 전문성 보유
- [ ] 해당 분야 실적/경력 있음
- [ ] 동료로부터 인정받음
- [ ] 허위 정보 유포 이력 없음

### 동기 분석
- [ ] 잠재적 이해충돌 파악
- [ ] 결과에 대한 재정적 이해관계?
- [ ] 정치적/이념적 동기?
- [ ] 개인적 불만 관련?

### 교차 검증
- [ ] 주장이 독립적으로 검증 가능?
- [ ] 다른 신뢰 출처가 확인?
- [ ] 문서 증거 존재?
- [ ] 반박하는 출처 존재?
```

### 신뢰도 등급

| 등급 | 기준 |
|------|------|
| **높음** | 실명, 관련 전문성, 문서 증거 제공, 이해충돌 없음 |
| **중간** | 실명이나 전문성 일부 불명확, 또는 간접 이해관계 |
| **낮음** | 익명, 전문성 미확인, 이해충돌 가능성 |
| **의심** | 허위 정보 이력, 명확한 이해충돌, 검증 불가 |

## 디지털 콘텐츠 검증

### 이미지 검증

```markdown
## 이미지 검증 프로세스

### 1단계: 역이미지 검색
- Google Images (images.google.com)
- TinEye (tineye.com)
- Yandex Images (yandex.com/images) — 얼굴 인식 최강
- Bing Visual Search

### 2단계: 메타데이터(EXIF) 확인
- 원본 촬영 날짜/시간
- 카메라/기기 정보
- GPS 좌표 (있는 경우)
- 편집에 사용된 소프트웨어

### 3단계: 이미지 내용 분석
- 날씨 조건 (보도된 날짜와 일치?)
- 그림자 (시간대와 일치?)
- 간판/텍스트 (해당 위치 언어?)
- 건축물 (주장된 장소와 일치?)

### 4단계: 원본 출처 찾기
- 온라인 최초 등장 시점
- 원본 촬영자/출처
- 최초 게시 맥락
- 다른 맥락에서 사용된 적 있는지
```

### SNS 계정 분석

```markdown
## 계정 검증 체크리스트

### 계정 이력
- 생성일 (오래될수록 신뢰도 높음)
- 게시 빈도와 패턴
- 활동 공백 (휴면 후 갑자기 활성화?)

### 네트워크
- 팔로워/팔로잉 비율
- 팔로워 품질 (실제 계정 vs 봇)
- 인증된 계정과의 상호 연결

### 레드 플래그
- 최근 생성된 계정이 대담한 주장
- 갑작스러운 주제/톤 변화
- 다른 계정과 조직적 행동
- 스톡 사진 프로필
```

### 문서 검증

```markdown
## 문서 검증 단계

### 메타데이터 검사
- 생성일 및 수정 이력
- 작성자 정보
- 사용된 소프트웨어
- 포함된 폰트/이미지

### 시각적 검사
- 전체적으로 일관된 서식
- 폰트 일치 (합성 텍스트 없는지)
- 텍스트/이미지 정렬
- 페이지 간 품질 일관성

### 내용 검증
- 날짜가 내부적으로 일관
- 이름 철자가 전체에서 일치
- 참조 번호 유효
- 연락처 정보 검증 가능
- 레터헤드가 알려진 예시와 일치

### 출처 추적
- 문서 입수 경로
- 보관 체인 기록 여부
- 원본 vs 사본
```

## 검증 기록 템플릿

```markdown
## 검증 기록

**검증 대상:** [주장/콘텐츠 설명]
**출처:** [이름/계정/플랫폼/URL]
**검증일:** [날짜]

### 검증 단계

#### 단계 1: [설명]
- 수행한 작업:
- 사용한 도구/방법:
- 결과:

#### 단계 2: [설명]
...

### 교차 확인 출처
1. [출처 1] — [확인 내용]
2. [출처 2] — [확인 내용]

### 반박 정보
1. [출처] — [반박 내용]

### 판정
- [ ] 검증됨 (사실)
- [ ] 높은 신뢰도 (사실 가능성 높음)
- [ ] 미검증 (증거 부족)
- [ ] 낮은 신뢰도 (반박 증거 존재)
- [ ] 거짓 확인

### 판정 근거
[증거 기반 결론 설명]
```

## 증거 보존

### 웹 아카이빙

- **Wayback Machine** (web.archive.org/save/) — 범용 웹 아카이브
- **Archive.today** (archive.ph) — 스냅샷 보존
- **Perma.cc** — 학술/법률용 영구 보존

### 스크린샷 원칙

1. 전체 페이지 캡처
2. URL 바 포함 (출처 URL 표시)
3. 타임스탬프 포함
4. PNG(무손실)와 PDF 모두 저장
5. 캡처 시점과 방법 기록

## 실행 규칙

### MUST DO
- SIFT 순서를 따른다 (멈추기 → 조사 → 다른 보도 → 원본 추적)
- WebSearch로 출처의 배경과 신뢰도를 조사한다
- 반박 증거도 적극 검색한다
- 검증 과정을 기록으로 남긴다

### MUST NOT DO
- 단일 출처만으로 "검증됨"이라 판정하지 않는다
- 출처의 자기 주장만으로 전문성을 인정하지 않는다
- 검증 과정 없이 직관으로 신뢰도를 판단하지 않는다
- SNS 팔로워 수만으로 신뢰도를 평가하지 않는다
