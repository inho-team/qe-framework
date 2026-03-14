> 공통 원칙: core/PRINCIPLES.md 참조

# Add JavaDoc Comments

프로젝트의 표준 JavaDoc 스타일에 따라 주석을 추가합니다.

## 사용법
`/add-javadoc` 또는 `/javadoc`

## 주석 스타일 가이드

### 클래스 주석
```java
/**
 * [클래스 설명]
 * <p>
 * 역할:
 * - [주요 역할 1]
 * - [주요 역할 2]
 * 위치:
 * - [모듈명]
 */
```

### 메서드 주석
```java
/**
 * [메서드 설명]
 *
 * @param [파라미터명] [파라미터 설명]
 * @return [반환값 설명]
 */
```

### 필드 주석 (record의 경우)
```java
/**
 * @param [필드명] [필드 설명]
 */
```

## 작업 지시사항

1. 주석이 없는 클래스, 메서드, 필드를 찾아서 주석을 추가하세요.

2. 주석 작성 시 다음 규칙을 따르세요:
   - 클래스: 역할과 위치를 명시
   - Repository: "데이터베이스 접근 구현체", 위치는 "storage-external"
   - Service: "비즈니스 서비스", 위치는 "core-api, Business Layer"
   - Controller: "API", 위치는 "core-api"
   - Converter: "타입 변경", 위치는 해당 모듈
   - Reader/Writer: "조회/저장 책임 빈", 위치는 해당 모듈
   - Data/Result: "모델", 위치는 해당 모듈

3. 메서드 주석은 간결하고 명확하게 작성:
   - 조회 메서드: "~를 조회"
   - 저장 메서드: "~를 저장"
   - 변환 메서드: "~를 ~로 변환"

4. @param과 @return은 반드시 포함

5. 한글로 작성하되, 기술 용어는 영문 그대로 사용

## 예시

### Before:
```java
public class MembershipService {
    public List<MembershipResponse> getMemberships(MembershipSearchRequest request) {
        // ...
    }
}
```

### After:
```java
/**
 * 멤버십 관련 비즈니스 서비스
 * <p>
 * 역할:
 * - Implement Layer class 오케스트레이션
 * 위치:
 * - core-api
 * - Business Layer
 */
public class MembershipService {
    /**
     * 멤버십 목록 조회
     *
     * @param request 멤버십 조회 요청
     * @return 멤버십 목록
     */
    public List<MembershipResponse> getMemberships(MembershipSearchRequest request) {
        // ...
    }
}
```

## 주의사항
- 이미 주석이 있는 경우 수정하지 마세요
- 프로젝트의 기존 주석 스타일을 분석하여 일관성 있게 작성하세요
- getter/setter, toString 등 자명한 메서드는 주석을 생략해도 됩니다