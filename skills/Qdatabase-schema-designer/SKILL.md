---
name: Qdatabase-schema-designer
description: "Designs SQL/NoSQL database schemas with normalization, indexing, migration, and constraint recommendations. Use for database design, schema design, DB schema, table structure, ERD, 데이터베이스 설계, or schema optimization."
license: MIT
---
> Shared principles: see core/PRINCIPLES.md


# Database Schema Design

Designs production-grade database schemas following best practices.

---

## Quick Start

Just describe your data model:

```
Design a schema for an e-commerce platform — I need users, products, and orders
```

You'll receive a complete SQL schema like this:

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

**Helpful to include in your request:**
- Entities (users, products, orders)
- Key relationships (users have orders, orders have items)
- Scale hints (high traffic, millions of records)
- DB preference (SQL/NoSQL) — defaults to SQL if unspecified

---

## Triggers

| Trigger | Example |
|---------|---------|
| `design schema` | "Design a schema for user authentication" |
| `database design` | "Design a DB for a multi-tenant SaaS" |
| `create tables` | "Create tables for a blog system" |
| `schema for` | "Schema for inventory management" |
| `data modeling` | "Data modeling for real-time analytics" |
| `need a DB` | "I need a DB for order tracking" |
| `NoSQL design` | "Design a NoSQL schema for a product catalog" |

---

## Key Terms

| Term | Definition |
|------|------------|
| **Normalization** | Organizing data to reduce redundancy (1NF → 2NF → 3NF) |
| **3NF** | Third Normal Form — no transitive dependencies between columns |
| **OLTP** | Online Transaction Processing — write-heavy, requires normalization |
| **OLAP** | Online Analytical Processing — read-heavy, denormalization can help |
| **Foreign Key (FK)** | A column referencing the primary key of another table |
| **Index** | A data structure that speeds up queries (at the cost of write speed) |
| **Access Pattern** | How the app reads and writes data (queries, joins, filters) |
| **Denormalization** | Intentionally storing redundant data to improve read performance |

---

## Quick Reference

| Task | Approach | Key Consideration |
|------|----------|-------------------|
| New schema | Normalize to 3NF first | Model the domain, not the UI |
| SQL vs NoSQL | Decide based on access patterns | Read/write ratio matters |
| Primary key | INT or UUID | Use UUID for distributed systems |
| Foreign key | Always add constraints | ON DELETE strategy is critical |
| Index | FK + WHERE columns | Column order matters |
| Migration | Always make it reversible | Backward compatibility first |

---

## Process Overview

```
Data Requirements
    |
    v
+-----------------------------------------------------+
| Step 1: Analysis                                     |
| * Identify entities and relationships                |
| * Understand access patterns (read vs. write ratio)  |
| * Choose SQL or NoSQL based on requirements          |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| Step 2: Design                                       |
| * Normalize to 3NF (SQL) or embed/reference (NoSQL) |
| * Define primary keys and foreign keys               |
| * Choose appropriate data types                      |
| * Add constraints (UNIQUE, CHECK, NOT NULL)          |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| Step 3: Optimization                                 |
| * Define indexing strategy                           |
| * Consider denormalization for read-heavy queries    |
| * Add timestamps (created_at, updated_at)            |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| Step 4: Migration                                    |
| * Generate migration scripts (up + down)             |
| * Ensure backward compatibility                      |
| * Plan for zero-downtime deployment                  |
+-----------------------------------------------------+
    |
    v
Production-Ready Schema
```

---

## Commands

| Command | When to Use | Action |
|---------|-------------|--------|
| `Design schema for {domain}` | Starting fresh | Generate full schema |
| `Normalize {table}` | Fixing existing tables | Apply normalization rules |
| `Add index to {table}` | Performance issues | Generate indexing strategy |
| `Migration for {change}` | Schema evolution | Create reversible migration |
| `Review schema` | Code review | Audit existing schema |

---

## Core Principles

| Principle | Why | How |
|-----------|-----|-----|
| Model the domain | UIs change; domains don't | Entity names reflect business concepts |
| Data integrity first | Corruption is expensive to fix | Enforce constraints at the DB level |
| Optimize for access patterns | Can't optimize for both | OLTP: normalize; OLAP: denormalize |
| Plan for scale | Retrofitting is painful | Define index strategy + partitioning plan |

---

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| VARCHAR(255) everywhere | Wastes storage, hides intent | Use appropriate size per field |
| FLOAT for money | Rounding errors | DECIMAL(10,2) |
| Missing FK constraints | Creates orphaned data | Always define foreign keys |
| No index on FK | Slow JOINs | Index every FK |
| Dates stored as strings | Can't compare or sort | Use DATE, TIMESTAMP types |
| SELECT * in queries | Fetches unnecessary data | Use explicit column lists |
| Irreversible migrations | Can't roll back | Always write DOWN migrations |
| Adding NOT NULL without default | Breaks existing rows | Add as nullable, backfill, then constrain |

---

## Validation Checklist

After designing a schema:

- [ ] Every table has a primary key
- [ ] Every relationship has a foreign key constraint
- [ ] ON DELETE strategy defined for each FK
- [ ] Index on every foreign key
- [ ] Index on frequently queried columns
- [ ] Appropriate data types (DECIMAL for money, etc.)
- [ ] NOT NULL on required fields
- [ ] UNIQUE constraints where needed
- [ ] CHECK constraints for validation
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

### First Normal Form (1NF)

```sql
-- Bad: multiple values in a column
CREATE TABLE orders (
  id INT PRIMARY KEY,
  product_ids VARCHAR(255)  -- '101,102,103'
);

-- Good: separate table for items
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

### Second Normal Form (2NF)

```sql
-- Bad: customer_name depends only on customer_id, not the composite key
CREATE TABLE order_items (
  order_id INT,
  product_id INT,
  customer_name VARCHAR(100),  -- partial dependency!
  PRIMARY KEY (order_id, product_id)
);

-- Good: customer data in its own table
CREATE TABLE customers (
  id INT PRIMARY KEY,
  name VARCHAR(100)
);
```

### Third Normal Form (3NF)

```sql
-- Bad: country depends on postal_code (transitive dependency)
CREATE TABLE customers (
  id INT PRIMARY KEY,
  postal_code VARCHAR(10),
  country VARCHAR(50)  -- transitive dependency!
);

-- Good: separate postal_codes table
CREATE TABLE postal_codes (
  code VARCHAR(10) PRIMARY KEY,
  country VARCHAR(50)
);
```

### When to Denormalize

| Scenario | Denormalization Strategy |
|----------|------------------------|
| Read-heavy reporting | Pre-computed aggregates |
| Expensive JOINs | Cached derived columns |
| Analytics dashboards | Materialized views |

</details>

<details>
<summary><strong>Deep Dive: Data Types</strong></summary>

### String Types

| Type | Use Case | Example |
|------|----------|---------|
| CHAR(n) | Fixed length | Country codes, ISO dates |
| VARCHAR(n) | Variable length | Names, emails |
| TEXT | Long content | Articles, descriptions |

### Numeric Types

| Type | Range | Use Case |
|------|-------|----------|
| TINYINT | -128 to 127 | Age, status codes |
| SMALLINT | -32K to 32K | Quantities |
| INT | -2.1B to 2.1B | IDs, counts |
| BIGINT | Very large | Large-scale IDs, timestamps |
| DECIMAL(p,s) | Exact precision | Money |
| FLOAT/DOUBLE | Approximate | Scientific data |

```sql
-- Always use DECIMAL for money
price DECIMAL(10, 2)  -- $99,999,999.99

-- Never use FLOAT for money
price FLOAT  -- rounding errors!
```

### Date/Time Types

```sql
DATE        -- 2025-10-31
TIME        -- 14:30:00
DATETIME    -- 2025-10-31 14:30:00
TIMESTAMP   -- auto timezone conversion

-- Always store in UTC
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

</details>

<details>
<summary><strong>Deep Dive: Indexing Strategy</strong></summary>

### When to Create an Index

| Always Index | Why |
|-------------|-----|
| Foreign keys | Speeds up JOINs |
| WHERE clause columns | Speeds up filtering |
| ORDER BY columns | Speeds up sorting |
| UNIQUE constraints | Enforces uniqueness |

### Index Types

| Type | Best For | Example |
|------|----------|---------|
| B-Tree | Range and equality | `price > 100` |
| Hash | Exact match only | `email = 'x@y.com'` |
| Full-text | Text search | `MATCH AGAINST` |
| Partial | Subset of rows | `WHERE is_active = true` |

### Composite Index Column Order

```sql
CREATE INDEX idx_customer_status ON orders(customer_id, status);

-- Uses index (customer_id is first)
SELECT * FROM orders WHERE customer_id = 123;
SELECT * FROM orders WHERE customer_id = 123 AND status = 'pending';

-- Does NOT use index (status alone)
SELECT * FROM orders WHERE status = 'pending';
```

**Rule:** Put the most selective column first, or the column most often queried alone.

</details>

<details>
<summary><strong>Deep Dive: Constraints</strong></summary>

### Primary Keys

```sql
-- Auto-increment (simple)
id INT AUTO_INCREMENT PRIMARY KEY

-- UUID (distributed systems)
id CHAR(36) PRIMARY KEY DEFAULT (UUID())

-- Composite (junction tables)
PRIMARY KEY (student_id, course_id)
```

### Foreign Keys

```sql
FOREIGN KEY (customer_id) REFERENCES customers(id)
  ON DELETE CASCADE     -- delete child when parent deleted
  ON DELETE RESTRICT    -- prevent deletion if referenced
  ON DELETE SET NULL    -- set to NULL when parent deleted
  ON UPDATE CASCADE     -- update child when parent changes
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

### Many-to-Many (N:M)

```sql
-- Junction table
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
-- Option 1: Separate FKs (strong integrity)
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

-- Option 2: Type + ID (flexible but weaker integrity)
CREATE TABLE comments (
  id INT PRIMARY KEY,
  content TEXT NOT NULL,
  commentable_type VARCHAR(50) NOT NULL,
  commentable_id INT NOT NULL
);
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

### Embedded Document

```json
{
  "_id": "order_123",
  "customer": {
    "id": "cust_456",
    "name": "Jane Doe",
    "email": "jane@example.com"
  },
  "items": [
    { "product_id": "prod_789", "quantity": 2, "price": 29.99 }
  ],
  "total": 109.97
}
```

### Referenced Document

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
<summary><strong>Deep Dive: Migrations</strong></summary>

### Migration Best Practices

| Practice | Why |
|----------|-----|
| Always make reversible | Rollbacks happen |
| Backward compatible | Zero-downtime deployment |
| Schema first, data second | Separation of concerns |
| Test on staging | Catch problems early |

### Adding a Column (Zero-Downtime)

```sql
-- Step 1: Add nullable column
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- Step 2: Deploy code that writes to new column
-- Step 3: Backfill existing rows
UPDATE users SET phone = '' WHERE phone IS NULL;

-- Step 4: Add NOT NULL constraint (if needed)
ALTER TABLE users MODIFY phone VARCHAR(20) NOT NULL;
```

### Migration Template

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
<summary><strong>Deep Dive: Performance Optimization</strong></summary>

### Query Analysis

```sql
EXPLAIN SELECT * FROM orders
WHERE customer_id = 123 AND status = 'pending';
```

| Check | Meaning |
|-------|---------|
| type: ALL | Full table scan (bad) |
| type: ref | Using index (good) |
| key: NULL | No index used |
| rows: high | Scanning many rows |

### N+1 Query Problem

```python
# Bad: N+1 queries
orders = db.query("SELECT * FROM orders")
for order in orders:
    customer = db.query(f"SELECT * FROM customers WHERE id = {order.customer_id}")

# Good: single JOIN
results = db.query("""
    SELECT orders.*, customers.name
    FROM orders
    JOIN customers ON orders.customer_id = customers.id
""")
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
