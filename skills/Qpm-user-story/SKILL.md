---
name: Qpm-user-story
description: Mike Cohn 형식과 Gherkin 수락 기준으로 유저스토리를 작성합니다. 사용자 니즈를 개발 준비된 작업으로 전환할 때 사용합니다. "유저스토리 작성해줘", "스토리 만들어줘", "수락 기준", "As a user" 등의 요청 시 사용합니다.
---
> 공통 원칙: core/PRINCIPLES.md 참조


## Purpose
Mike Cohn의 유저스토리 형식과 Gherkin 수락 기준을 결합하여 명확하고 간결한 유저스토리를 생성합니다. 사용자 니즈를 결과 중심의 개발 작업으로 전환하고 테스트 가능한 성공 기준을 제공합니다.

## 핵심 형식

### Use Case (Mike Cohn 형식)
```
As a [사용자 페르소나/역할]
I want to [결과를 달성하기 위한 액션]
so that [원하는 결과]
```

### 수락 기준 (Gherkin 형식)
```
Scenario: [시나리오 간략 설명]
Given: [초기 컨텍스트 또는 전제 조건]
and Given: [추가 전제 조건]
When: [액션을 트리거하는 이벤트]
Then: [예상 결과]
```

## 워크플로우

### Step 1: 컨텍스트 수집
- 사용자 페르소나 확인
- 해결하는 문제 이해
- 원하는 결과 정의
- 제약사항 파악

### Step 2: Use Case 작성
```markdown
### 유저스토리 [ID]:
- **Summary:** [가치 중심의 간결한 제목]

#### Use Case:
- **As a** [사용 가능하면 사용자 이름, 아니면 페르소나]
- **I want to** [사용자가 결과에 도달하기 위한 액션]
- **so that** [원하는 결과]
```

**품질 체크:**
- "As a"가 구체적인가? (예: "trial user" vs "user")
- "I want to"가 기능이 아닌 사용자 액션인가?
- "So that"이 동기를 설명하는가?

### Step 3: 수락 기준 작성
```markdown
#### 수락 기준:
- **Scenario:** [시나리오 설명]
- **Given:** [전제 조건]
- **and Given:** [추가 전제 조건]
- **When:** [트리거 이벤트]
- **Then:** [예상 결과]
```

**규칙:**
- When은 1개만 (여러 개 = 스토리 분리 필요)
- Then은 1개만 (여러 개 = 스토리 분리 필요)
- Then은 측정 가능해야 함

### Step 4: Summary 작성
```markdown
- **Summary:** 가치 중심의 짧고 기억하기 쉬운 제목
```
✅ "마찰 감소를 위해 trial user에게 Google 로그인 활성화"
❌ "로그인 버튼 추가"

### Step 5: 검증 및 개선
- 팀에 소리 내어 읽기
- QA가 테스트 케이스 작성 가능한지 확인
- 너무 크면 스토리 분리

## 좋은 예시
```markdown
### 유저스토리 042:
- **Summary:** 마찰 감소를 위해 trial user에게 Google 로그인 활성화

#### Use Case:
- **As a** 처음 앱을 방문하는 trial user
- **I want to** Google 계정으로 로그인하기
- **so that** 새 비밀번호를 만들고 기억하지 않고 앱에 접근할 수 있다

#### 수락 기준:
- **Scenario:** 처음 방문한 trial user가 Google OAuth로 로그인
- **Given:** 로그인 페이지에 있다
- **and Given:** 로그인 계정이 있다
- **When:** "Google로 로그인" 버튼을 클릭하고 앱을 승인한다
- **Then:** 앱에 로그인되고 온보딩 흐름으로 리다이렉트된다
```

## 안티패턴
- ❌ "As a developer, I want to..." → 기술 태스크, 유저스토리 아님
- ❌ "As a user" (너무 일반적) → 구체적 페르소나 사용
- ❌ "so that I can save" (액션 반복) → 실제 동기 작성
- ❌ 여러 When/Then → 스토리 분리 필요
- ❌ "Then 경험이 개선된다" (측정 불가) → 구체적으로

Credits: Original skill by @deanpeters - https://github.com/deanpeters/Product-Manager-Skills
