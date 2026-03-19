---
name: Qdatabase-schema-designer
description: "Designs SQL/NoSQL database schemas with normalization, indexing, migration, and constraint recommendations. Use for database design, schema design, DB schema, table structure, ERD, 데이터베이스 설계, or schema optimization."
license: MIT
---

# Database Schema Design

Designs production-grade database schemas following best practices.

---

## Quick Start

Describe your data model:
```
Design a schema for an e-commerce platform — I need users, products, and orders
```

**Helpful to include:** entities, key relationships, scale hints, DB preference (SQL/NoSQL — defaults to SQL).

---

## Commands

| Command | When to Use |
|---------|-------------|
| `Design schema for {domain}` | Starting fresh — generate full schema |
| `Normalize {table}` | Fix existing tables — apply normalization |
| `Add index to {table}` | Performance issues — generate indexing strategy |
| `Migration for {change}` | Schema evolution — create reversible migration |
| `Review schema` | Code review — audit existing schema |

---

## Core Principles

| Principle | Why | How |
|-----------|-----|-----|
| Model the domain | UIs change; domains don't | Entity names reflect business concepts |
| Data integrity first | Corruption is expensive | Enforce constraints at DB level |
| Optimize for access patterns | Can't optimize for both | OLTP: normalize; OLAP: denormalize |
| Plan for scale | Retrofitting is painful | Define index strategy + partitioning plan |

---

## Process Overview

```
Data Requirements → Step 1: Analysis → Step 2: Design → Step 3: Optimization → Step 4: Migration → Production-Ready Schema
```

**Step 1 — Analysis:** Identify entities/relationships, understand access patterns (read vs write ratio), choose SQL or NoSQL.

**Step 2 — Design:** Normalize to 3NF (SQL) or embed/reference (NoSQL), define PK/FK, choose data types, add constraints (UNIQUE, CHECK, NOT NULL).

**Step 3 — Optimization:** Define indexing strategy, consider denormalization for read-heavy queries, add timestamps (created_at, updated_at).

**Step 4 — Migration:** Generate up + down scripts, ensure backward compatibility, plan zero-downtime deployment.

---

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| VARCHAR(255) everywhere | Wastes storage, hides intent | Appropriate size per field |
| FLOAT for money | Rounding errors | DECIMAL(10,2) |
| Missing FK constraints | Orphaned data | Always define foreign keys |
| No index on FK | Slow JOINs | Index every FK |
| Dates as strings | Can't compare/sort | DATE, TIMESTAMP types |
| SELECT * | Fetches unnecessary data | Explicit column lists |
| Irreversible migrations | Can't roll back | Always write DOWN migrations |
| NOT NULL without default | Breaks existing rows | Add nullable, backfill, then constrain |

---

## Validation Checklist

- [ ] Every table has a primary key
- [ ] Every relationship has FK constraint with ON DELETE strategy
- [ ] Index on every FK and frequently queried columns
- [ ] Appropriate data types (DECIMAL for money, etc.)
- [ ] NOT NULL on required fields; UNIQUE/CHECK where needed
- [ ] created_at and updated_at timestamps present
- [ ] Migration scripts are reversible
- [ ] Tested with production-representative data on staging

---

<details>
<summary><strong>Deep Dive: Normalization (SQL)</strong></summary>

### Normal Forms

| Form | Rule | Violation Example |
|------|------|------------------|
| **1NF** | Atomic values, no repeating groups | `product_ids = '1,2,3'` |
| **2NF** | 1NF + no partial dependencies | customer_name in order_items |
| **3NF** | 2NF + no transitive dependencies | country derived from postal_code |

**1NF fix:** Separate table for multi-valued attributes.
```sql
-- Bad: product_ids VARCHAR(255)  -- '101,102,103'
-- Good: order_items table with FK to orders
```

**2NF fix:** Move partially-dependent columns to their own table.

**3NF fix:** Move transitively-dependent columns (e.g., country depends on postal_code, not on PK).

### When to Denormalize

| Scenario | Strategy |
|----------|----------|
| Read-heavy reporting | Pre-computed aggregates |
| Expensive JOINs | Cached derived columns |
| Analytics dashboards | Materialized views |

</details>

<details>
<summary><strong>Deep Dive: Data Types</strong></summary>

| Category | Type | Use Case |
|----------|------|----------|
| String | CHAR(n) | Fixed length (country codes) |
| String | VARCHAR(n) | Variable length (names, emails) |
| String | TEXT | Long content (articles) |
| Numeric | INT/BIGINT | IDs, counts |
| Numeric | DECIMAL(p,s) | Money (exact precision) |
| Numeric | FLOAT/DOUBLE | Scientific data (approximate) |
| Date | DATE/TIMESTAMP | Always store in UTC |

```sql
price DECIMAL(10, 2)  -- correct for money
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

</details>

<details>
<summary><strong>Deep Dive: Indexing Strategy</strong></summary>

### When to Index

| Always Index | Why |
|-------------|-----|
| Foreign keys | Speeds up JOINs |
| WHERE clause columns | Speeds up filtering |
| ORDER BY columns | Speeds up sorting |
| UNIQUE constraints | Enforces uniqueness |

### Index Types

| Type | Best For |
|------|----------|
| B-Tree | Range and equality (`price > 100`) |
| Hash | Exact match only (`email = 'x@y.com'`) |
| Full-text | Text search |
| Partial | Subset of rows (`WHERE is_active = true`) |

### Composite Index Column Order
```sql
CREATE INDEX idx_customer_status ON orders(customer_id, status);
-- Uses index: WHERE customer_id = 123
-- Uses index: WHERE customer_id = 123 AND status = 'pending'
-- Does NOT use index: WHERE status = 'pending' (alone)
```
**Rule:** Most selective column first, or column most often queried alone.

</details>

<details>
<summary><strong>Deep Dive: Constraints</strong></summary>

### Primary Keys
```sql
id INT AUTO_INCREMENT PRIMARY KEY          -- simple
id CHAR(36) PRIMARY KEY DEFAULT (UUID())   -- distributed systems
PRIMARY KEY (student_id, course_id)        -- junction tables
```

### Foreign Keys
```sql
FOREIGN KEY (customer_id) REFERENCES customers(id)
  ON DELETE CASCADE     -- delete child when parent deleted
  ON DELETE RESTRICT    -- prevent deletion if referenced
  ON DELETE SET NULL    -- set NULL when parent deleted
```

| Strategy | Use When |
|----------|----------|
| CASCADE | Dependent data (order_items) |
| RESTRICT | Critical references (prevent accidents) |
| SET NULL | Optional relationships |

</details>

<details>
<summary><strong>Deep Dive: Relationship Patterns</strong></summary>

### One-to-Many (1:N)
```sql
CREATE TABLE order_items (
  id INT PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL,
  quantity INT NOT NULL
);
```

### Many-to-Many (N:M)
```sql
CREATE TABLE enrollments (
  student_id INT REFERENCES students(id) ON DELETE CASCADE,
  course_id INT REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, course_id)
);
```

### Self-Referential
```sql
CREATE TABLE employees (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  manager_id INT REFERENCES employees(id)
);
```

### Polymorphic
```sql
-- Option 1: Separate FKs (strong integrity, use CHECK constraint)
-- Option 2: Type + ID columns (flexible but weaker integrity)
```

</details>

<details>
<summary><strong>Deep Dive: NoSQL Design (MongoDB)</strong></summary>

### Embed vs. Reference

| Factor | Embed | Reference |
|--------|-------|-----------|
| Access pattern | Read together | Read separately |
| Relationship | 1:few | 1:many |
| Document size | Small | Near 16MB |
| Update frequency | Infrequent | Frequent |

**Embedded:** Customer data inside order document (denormalized, fast reads).
**Referenced:** Store customer_id, look up separately (normalized, flexible updates).

</details>

<details>
<summary><strong>Deep Dive: Migrations</strong></summary>

| Practice | Why |
|----------|-----|
| Always reversible | Rollbacks happen |
| Backward compatible | Zero-downtime deployment |
| Schema first, data second | Separation of concerns |
| Test on staging | Catch problems early |

### Zero-Downtime Column Addition
1. Add nullable column
2. Deploy code that writes to new column
3. Backfill existing rows
4. Add NOT NULL constraint (if needed)

### Migration Template
```sql
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
<summary><strong>Deep Dive: Performance Optimization</strong></summary>

### Query Analysis
```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 123 AND status = 'pending';
```
Check: `type: ALL` (full scan = bad), `type: ref` (index = good), `key: NULL` (no index used).

### N+1 Query Problem
```python
# Bad: N+1 queries — loop with individual SELECTs
# Good: single JOIN query
```

### Optimization Techniques

| Technique | When to Use |
|-----------|-------------|
| Add index | Slow WHERE/ORDER BY |
| Denormalize | Expensive JOINs |
| Pagination | Large result sets |
| Caching | Repeated queries |
| Read replica | Read-heavy load |
| Partitioning | Very large tables |

</details>
