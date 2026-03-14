---
name: Qdoc-comment
description: 프로젝트 언어에 맞는 문서화 주석을 자동으로 추가합니다. Java(JavaDoc), Python(docstring), TypeScript(TSDoc), Go(godoc), Kotlin(KDoc), Rust(rustdoc) 등을 지원합니다.
---
> 공통 원칙: core/PRINCIPLES.md 참조

# Qdoc-comment — 문서화 주석 추가

## 역할
프로젝트의 언어와 기존 주석 스타일을 자동 감지하여, 주석이 없는 클래스/함수/메서드에 문서화 주석을 추가합니다.

## 실행 절차

### 1단계: 언어 감지
- `.qe/analysis/tech-stack.md`를 먼저 참조하여 프로젝트 언어 파악
- 없으면 파일 확장자로 판별 (.java, .py, .ts, .go, .kt 등)

### 2단계: 기존 스타일 분석
- 프로젝트 내 기존 주석을 샘플링하여 스타일 파악
- 언어, 톤, 포맷(한글/영문, 태그 사용 여부 등) 일관성 유지

### 3단계: 주석 추가
- 주석이 없는 공개(public/exported) 클래스/함수/메서드를 찾아 추가
- 기존 주석이 있으면 수정하지 않음

## 언어별 주석 형식

### Java (JavaDoc)
```java
/**
 * [클래스/메서드 설명]
 *
 * @param paramName [설명]
 * @return [반환값 설명]
 */
```

### Python (docstring)
```python
def example(param: str) -> bool:
    """[함수 설명]

    Args:
        param: [설명]

    Returns:
        [반환값 설명]
    """
```

### TypeScript / JavaScript (TSDoc/JSDoc)
```typescript
/**
 * [함수 설명]
 *
 * @param paramName - [설명]
 * @returns [반환값 설명]
 */
```

### Go (godoc)
```go
// FunctionName [함수 설명]
//
// [상세 설명이 필요한 경우]
```

### Kotlin (KDoc)
```kotlin
/**
 * [클래스/함수 설명]
 *
 * @param paramName [설명]
 * @return [반환값 설명]
 */
```

### Rust (rustdoc)
```rust
/// [함수 설명]
///
/// # Arguments
/// * `param` - [설명]
///
/// # Returns
/// [반환값 설명]
```

## 주석 작성 규칙
- 프로젝트 기존 언어(한글/영문)를 따름
- 기술 용어는 원문 그대로 사용
- 간결하고 명확하게 — "~를 조회", "~를 저장", "~를 변환"
- 자명한 함수(getter/setter, toString 등)는 생략

## 할 것 (Will)
- 언어 자동 감지
- 기존 스타일에 맞는 주석 추가
- 공개 API 및 복잡한 private/internal 함수에 주석 작성

## 안 할 것 (Will Not)
- 기존 주석 수정/덮어쓰기
- 자명한 함수(getter/setter, 단순 위임)에 불필요한 주석 강제
- 코드 로직 변경
