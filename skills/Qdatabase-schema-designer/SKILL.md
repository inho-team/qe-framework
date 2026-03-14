---
name: Qdatabase-schema-designer
description: 견고하고 확장 가능한 SQL/NoSQL 데이터베이스 스키마를 설계합니다. 정규화 가이드라인, 인덱싱 전략, 마이그레이션 패턴, 제약조건 설계, 성능 최적화를 제공합니다.
license: MIT
---
> 공통 원칙: core/PRINCIPLES.md 참조


# 데이터베이스 스키마 설계

프로덕션 수준의 데이터베이스 스키마를 모범 사례를 반영하여 설계합니다.

---

## 빠른 시작

데이터 모델을 설명하면 됩니다:

```
이커머스 플랫폼용 스키마를 설계해줘 - 사용자, 상품, 주문이 필요해
```

다음과 같은 완전한 SQL 스키마를 받게 됩니다:

```sql
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  total DECIMAL(10,2) NOT NULL,
  INDEX idx_orders_user (user_id)
);
```

**요청에 포함하면 좋은 것들:**
- 엔티티 (사용자, 상품, 주문)
- 주요 관계 (사용자가 주문을 가지고, 주문에 항목이 있음)
- 규모 힌트 (고트래픽, 수백만 레코드)
- DB 선호도 (SQL/NoSQL) - 미지정 시 SQL 기본

---

## 트리거

| 트리거 | 예시 |
|--------|------|
| `스키마 설계` | "사용자 인증용 스키마 설계해줘" |
| `데이터베이스 설계` | "멀티테넌트 SaaS용 DB 설계" |
| `테이블 생성` | "블로그 시스템 테이블 만들어줘" |
| `schema for` | "재고 관리용 스키마" |
| `데이터 모델링` | "실시간 분석용 데이터 모델링" |
| `DB가 필요해` | "주문 추적용 DB가 필요해" |
| `NoSQL 설계` | "상품 카탈로그용 NoSQL 스키마 설계" |

---

## 핵심 용어

| 용어 | 정의 |
|------|------|
| **정규화** | 중복을 줄이기 위한 데이터 구성 (1NF -> 2NF -> 3NF) |
| **3NF** | 제3정규형 - 컬럼 간 이행 종속성 없음 |
| **OLTP** | 온라인 트랜잭션 처리 - 쓰기 중심, 정규화 필요 |
| **OLAP** | 온라인 분석 처리 - 읽기 중심, 비정규화가 유리 |
| **외래 키(FK)** | 다른 테이블의 기본 키를 참조하는 컬럼 |
| **인덱스** | 쿼리 속도를 높이는 자료구조 (쓰기 속도 저하 비용) |
| **접근 패턴** | 앱이 데이터를 읽고 쓰는 방식 (쿼리, 조인, 필터) |
| **비정규화** | 읽기 속도를 높이기 위해 의도적으로 데이터를 중복 저장 |

---

## 빠른 참조

| 작업 | 접근법 | 핵심 고려사항 |
|------|--------|--------------|
| 새 스키마 | 먼저 3NF로 정규화 | UI보다 도메인 모델링 우선 |
| SQL vs NoSQL | 접근 패턴으로 결정 | 읽기/쓰기 비율이 중요 |
| 기본 키 | INT 또는 UUID | 분산 시스템이면 UUID |
| 외래 키 | 항상 제약조건 설정 | ON DELETE 전략이 핵심 |
| 인덱스 | FK + WHERE 컬럼 | 컬럼 순서가 중요 |
| 마이그레이션 | 항상 되돌릴 수 있게 | 하위 호환성 우선 |

---

## 프로세스 개요

```
데이터 요구사항
    |
    v
+-----------------------------------------------------+
| 1단계: 분석                                          |
| * 엔티티와 관계 식별                                  |
| * 접근 패턴 파악 (읽기 vs 쓰기 비중)                   |
| * 요구사항에 따라 SQL 또는 NoSQL 선택                   |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| 2단계: 설계                                          |
| * 3NF로 정규화(SQL) 또는 임베드/참조(NoSQL)             |
| * 기본 키, 외래 키 정의                                |
| * 적절한 데이터 타입 선택                               |
| * 제약조건 추가 (UNIQUE, CHECK, NOT NULL)              |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| 3단계: 최적화                                        |
| * 인덱싱 전략 수립                                    |
| * 읽기 중심 쿼리에 비정규화 고려                        |
| * 타임스탬프 추가 (created_at, updated_at)             |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| 4단계: 마이그레이션                                   |
| * 마이그레이션 스크립트 생성 (up + down)                 |
| * 하위 호환성 보장                                     |
| * 무중단 배포 계획                                     |
+-----------------------------------------------------+
    |
    v
프로덕션 준비 완료 스키마
```

---

## 명령어

| 명령어 | 사용 시점 | 동작 |
|--------|----------|------|
| `{도메인}용 스키마 설계` | 새로 시작할 때 | 전체 스키마 생성 |
| `{테이블} 정규화` | 기존 테이블 수정 | 정규화 규칙 적용 |
| `{테이블}에 인덱스 추가` | 성능 문제 시 | 인덱스 전략 생성 |
| `{변경}에 대한 마이그레이션` | 스키마 진화 | 되돌릴 수 있는 마이그레이션 생성 |
| `스키마 리뷰` | 코드 리뷰 | 기존 스키마 감사 |

---

## 핵심 원칙

| 원칙 | 이유 | 구현 |
|------|------|------|
| 도메인을 모델링하라 | UI는 변하지만 도메인은 안 변함 | 엔티티명이 비즈니스 개념을 반영 |
| 데이터 무결성 우선 | 손상은 복구 비용이 큼 | DB 수준에서 제약조건 |
| 접근 패턴에 최적화 | 둘 다 최적화는 불가 | OLTP: 정규화, OLAP: 비정규화 |
| 확장을 계획하라 | 사후 대응은 고통스러움 | 인덱스 전략 + 파티셔닝 계획 |

---

## 안티패턴

| 피할 것 | 이유 | 대신 |
|---------|------|------|
| 모든 곳에 VARCHAR(255) | 저장소 낭비, 의도 숨김 | 필드별 적절한 크기 지정 |
| 금액에 FLOAT | 반올림 오류 | DECIMAL(10,2) |
| FK 제약조건 누락 | 고아 데이터 발생 | 항상 외래 키 정의 |
| FK에 인덱스 없음 | 느린 JOIN | 모든 FK에 인덱스 |
| 날짜를 문자열로 저장 | 비교/정렬 불가 | DATE, TIMESTAMP 타입 |
| 쿼리에 SELECT * | 불필요한 데이터 가져옴 | 명시적 컬럼 목록 |
| 되돌릴 수 없는 마이그레이션 | 롤백 불가 | 항상 DOWN 마이그레이션 작성 |
| 기본값 없이 NOT NULL 추가 | 기존 행 깨짐 | nullable로 추가, 백필, 그 후 제약 |

---

## 검증 체크리스트

스키마 설계 후:

- [ ] 모든 테이블에 기본 키가 있는가
- [ ] 모든 관계에 외래 키 제약조건이 있는가
- [ ] 각 FK에 ON DELETE 전략이 정의되었는가
- [ ] 모든 외래 키에 인덱스가 있는가
- [ ] 자주 조회하는 컬럼에 인덱스가 있는가
- [ ] 적절한 데이터 타입인가 (금액에 DECIMAL 등)
- [ ] 필수 필드에 NOT NULL이 있는가
- [ ] 필요한 곳에 UNIQUE 제약조건이 있는가
- [ ] 유효성 검증을 위한 CHECK 제약조건이 있는가
- [ ] created_at과 updated_at 타임스탬프가 있는가
- [ ] 마이그레이션 스크립트가 되돌릴 수 있는가
- [ ] 스테이징에서 프로덕션 데이터로 테스트했는가

---

<details>
<summary><strong>심화: 정규화 (SQL)</strong></summary>

### 정규형

| 정규형 | 규칙 | 위반 예시 |
|--------|------|----------|
| **1NF** | 원자 값, 반복 그룹 없음 | `product_ids = '1,2,3'` |
| **2NF** | 1NF + 부분 종속성 없음 | order_items에 customer_name |
| **3NF** | 2NF + 이행 종속성 없음 | postal_code에서 파생된 country |

### 제1정규형 (1NF)

```sql
-- 나쁨: 컬럼에 다중 값
CREATE TABLE orders (
  id INT PRIMARY KEY,
  product_ids VARCHAR(255)  -- '101,102,103'
);

-- 좋음: 항목용 별도 테이블
CREATE TABLE orders (
  id INT PRIMARY KEY,
  customer_id INT
);

CREATE TABLE order_items (
  id INT PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  product_id INT
);
```

### 제2정규형 (2NF)

```sql
-- 나쁨: customer_name이 customer_id에만 종속
CREATE TABLE order_items (
  order_id INT,
  product_id INT,
  customer_name VARCHAR(100),  -- 부분 종속!
  PRIMARY KEY (order_id, product_id)
);

-- 좋음: 고객 데이터를 별도 테이블에
CREATE TABLE customers (
  id INT PRIMARY KEY,
  name VARCHAR(100)
);
```

### 제3정규형 (3NF)

```sql
-- 나쁨: country가 postal_code에 종속
CREATE TABLE customers (
  id INT PRIMARY KEY,
  postal_code VARCHAR(10),
  country VARCHAR(50)  -- 이행 종속!
);

-- 좋음: postal_codes 테이블 분리
CREATE TABLE postal_codes (
  code VARCHAR(10) PRIMARY KEY,
  country VARCHAR(50)
);
```

### 비정규화가 필요한 경우

| 시나리오 | 비정규화 전략 |
|----------|-------------|
| 읽기 중심 리포팅 | 미리 계산된 집계 |
| 비용 높은 JOIN | 캐시된 파생 컬럼 |
| 분석 대시보드 | 구체화된 뷰 |

</details>

<details>
<summary><strong>심화: 데이터 타입</strong></summary>

### 문자열 타입

| 타입 | 용도 | 예시 |
|------|------|------|
| CHAR(n) | 고정 길이 | 국가 코드, ISO 날짜 |
| VARCHAR(n) | 가변 길이 | 이름, 이메일 |
| TEXT | 긴 콘텐츠 | 기사, 설명 |

### 숫자 타입

| 타입 | 범위 | 용도 |
|------|------|------|
| TINYINT | -128 ~ 127 | 나이, 상태 코드 |
| SMALLINT | -32K ~ 32K | 수량 |
| INT | -21억 ~ 21억 | ID, 카운트 |
| BIGINT | 매우 큰 범위 | 대규모 ID, 타임스탬프 |
| DECIMAL(p,s) | 정확한 정밀도 | 금액 |
| FLOAT/DOUBLE | 근사값 | 과학 데이터 |

```sql
-- 금액에는 반드시 DECIMAL
price DECIMAL(10, 2)  -- $99,999,999.99

-- 금액에 절대 FLOAT 사용 금지
price FLOAT  -- 반올림 오류!
```

### 날짜/시간 타입

```sql
DATE        -- 2025-10-31
TIME        -- 14:30:00
DATETIME    -- 2025-10-31 14:30:00
TIMESTAMP   -- 자동 시간대 변환

-- 항상 UTC로 저장
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

</details>

<details>
<summary><strong>심화: 인덱싱 전략</strong></summary>

### 인덱스를 만들어야 할 때

| 항상 인덱스 | 이유 |
|------------|------|
| 외래 키 | JOIN 속도 향상 |
| WHERE 절 컬럼 | 필터링 속도 향상 |
| ORDER BY 컬럼 | 정렬 속도 향상 |
| 유니크 제약조건 | 고유성 보장 |

### 인덱스 타입

| 타입 | 적합한 경우 | 예시 |
|------|------------|------|
| B-Tree | 범위, 동등 비교 | `price > 100` |
| Hash | 정확한 일치만 | `email = 'x@y.com'` |
| Full-text | 텍스트 검색 | `MATCH AGAINST` |
| Partial | 행의 부분집합 | `WHERE is_active = true` |

### 복합 인덱스 순서

```sql
CREATE INDEX idx_customer_status ON orders(customer_id, status);

-- 인덱스 사용 (customer_id가 첫 번째)
SELECT * FROM orders WHERE customer_id = 123;
SELECT * FROM orders WHERE customer_id = 123 AND status = 'pending';

-- 인덱스 사용 안 됨 (status만 단독)
SELECT * FROM orders WHERE status = 'pending';
```

**규칙:** 선택도가 가장 높은 컬럼을 먼저, 또는 단독으로 가장 많이 조회되는 컬럼을 먼저.

</details>

<details>
<summary><strong>심화: 제약조건</strong></summary>

### 기본 키

```sql
-- 자동 증가 (단순)
id INT AUTO_INCREMENT PRIMARY KEY

-- UUID (분산 시스템)
id CHAR(36) PRIMARY KEY DEFAULT (UUID())

-- 복합 (연결 테이블)
PRIMARY KEY (student_id, course_id)
```

### 외래 키

```sql
FOREIGN KEY (customer_id) REFERENCES customers(id)
  ON DELETE CASCADE     -- 부모 삭제 시 자식도 삭제
  ON DELETE RESTRICT    -- 참조되면 삭제 방지
  ON DELETE SET NULL    -- 부모 삭제 시 NULL로 설정
  ON UPDATE CASCADE     -- 부모 변경 시 자식도 업데이트
```

| 전략 | 사용 시점 |
|------|----------|
| CASCADE | 종속 데이터 (order_items) |
| RESTRICT | 중요한 참조 (실수 방지) |
| SET NULL | 선택적 관계 |

</details>

<details>
<summary><strong>심화: 관계 패턴</strong></summary>

### 일대다 (1:N)

```sql
CREATE TABLE orders (
  id INT PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id)
);

CREATE TABLE order_items (
  id INT PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL,
  quantity INT NOT NULL
);
```

### 다대다 (N:M)

```sql
-- 연결 테이블
CREATE TABLE enrollments (
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  course_id INT REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, course_id)
);
```

### 자기 참조

```sql
CREATE TABLE employees (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  manager_id INT REFERENCES employees(id)
);
```

### 다형성

```sql
-- 방법 1: 별도 FK (무결성 강함)
CREATE TABLE comments (
  id INT PRIMARY KEY,
  content TEXT NOT NULL,
  post_id INT REFERENCES posts(id),
  photo_id INT REFERENCES photos(id),
  CHECK (
    (post_id IS NOT NULL AND photo_id IS NULL) OR
    (post_id IS NULL AND photo_id IS NOT NULL)
  )
);

-- 방법 2: 타입 + ID (유연하지만 무결성 약함)
CREATE TABLE comments (
  id INT PRIMARY KEY,
  content TEXT NOT NULL,
  commentable_type VARCHAR(50) NOT NULL,
  commentable_id INT NOT NULL
);
```

</details>

<details>
<summary><strong>심화: NoSQL 설계 (MongoDB)</strong></summary>

### 임베딩 vs 참조

| 요소 | 임베드 | 참조 |
|------|--------|------|
| 접근 패턴 | 함께 읽음 | 따로 읽음 |
| 관계 | 1:소수 | 1:다수 |
| 문서 크기 | 작음 | 16MB에 근접 |
| 업데이트 빈도 | 드물게 | 자주 |

### 임베디드 문서

```json
{
  "_id": "order_123",
  "customer": {
    "id": "cust_456",
    "name": "홍길동",
    "email": "hong@example.com"
  },
  "items": [
    { "product_id": "prod_789", "quantity": 2, "price": 29.99 }
  ],
  "total": 109.97
}
```

### 참조 문서

```json
{
  "_id": "order_123",
  "customer_id": "cust_456",
  "item_ids": ["item_1", "item_2"],
  "total": 109.97
}
```

</details>

<details>
<summary><strong>심화: 마이그레이션</strong></summary>

### 마이그레이션 모범 사례

| 사례 | 이유 |
|------|------|
| 항상 되돌릴 수 있게 | 롤백이 필요함 |
| 하위 호환 | 무중단 배포 |
| 스키마 먼저, 데이터 나중 | 관심사 분리 |
| 스테이징에서 테스트 | 문제를 조기에 발견 |

### 컬럼 추가 (무중단)

```sql
-- 1단계: nullable 컬럼 추가
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- 2단계: 새 컬럼에 쓰는 코드 배포
-- 3단계: 기존 행 백필
UPDATE users SET phone = '' WHERE phone IS NULL;

-- 4단계: 필수로 변경 (필요 시)
ALTER TABLE users MODIFY phone VARCHAR(20) NOT NULL;
```

### 마이그레이션 템플릿

```sql
-- Migration: YYYYMMDDHHMMSS_description.sql

-- UP
BEGIN;
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
CREATE INDEX idx_users_phone ON users(phone);
COMMIT;

-- DOWN
BEGIN;
DROP INDEX idx_users_phone ON users;
ALTER TABLE users DROP COLUMN phone;
COMMIT;
```

</details>

<details>
<summary><strong>심화: 성능 최적화</strong></summary>

### 쿼리 분석

```sql
EXPLAIN SELECT * FROM orders
WHERE customer_id = 123 AND status = 'pending';
```

| 확인 항목 | 의미 |
|----------|------|
| type: ALL | 풀 테이블 스캔 (나쁨) |
| type: ref | 인덱스 사용 (좋음) |
| key: NULL | 인덱스 미사용 |
| rows: 높음 | 많은 행 스캔 |

### N+1 쿼리 문제

```python
# 나쁨: N+1 쿼리
orders = db.query("SELECT * FROM orders")
for order in orders:
    customer = db.query(f"SELECT * FROM customers WHERE id = {order.customer_id}")

# 좋음: 단일 JOIN
results = db.query("""
    SELECT orders.*, customers.name
    FROM orders
    JOIN customers ON orders.customer_id = customers.id
""")
```

### 최적화 기법

| 기법 | 사용 시점 |
|------|----------|
| 인덱스 추가 | 느린 WHERE/ORDER BY |
| 비정규화 | 비용 높은 JOIN |
| 페이지네이션 | 대규모 결과 집합 |
| 캐싱 | 반복 쿼리 |
| 읽기 복제본 | 읽기 중심 부하 |
| 파티셔닝 | 매우 큰 테이블 |

</details>
