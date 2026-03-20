---
name: Qdatabase-schema-designer
description: "Designs SQL/NoSQL database schemas with normalization, indexing, migration, and constraint recommendations. Use when the user asks for database design, schema design, DB schema, table structure, ERD, or schema optimization."
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
Data Requirements → 1. Analysis → 2. Design → 3. Optimization → 4. Migration → Production-Ready Schema
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
| Irreversible migrations | Can't roll back | Always write DOWN migrations |

---

## Validation Checklist

- [ ] Every table has a primary key
- [ ] Every relationship has FK constraint with ON DELETE strategy
- [ ] Index on every FK and frequently queried columns
- [ ] Appropriate data types (DECIMAL for money, etc.)
- [ ] NOT NULL on required fields; UNIQUE/CHECK where needed
- [ ] created_at and updated_at timestamps present
- [ ] Migration scripts are reversible

---

## Normalization (SQL)

| Form | Rule | Violation Example |
|------|------|------------------|
| **1NF** | Atomic values, no repeating groups | `product_ids = '1,2,3'` |
| **2NF** | 1NF + no partial dependencies | customer_name in order_items |
| **3NF** | 2NF + no transitive dependencies | country derived from postal_code |

**When to Denormalize:** Read-heavy reporting (pre-computed aggregates), expensive JOINs (cached derived columns), analytics dashboards (materialized views).

---

## Data Types

| Category | Type | Use Case |
|----------|------|----------|
| String | CHAR(n) / VARCHAR(n) / TEXT | Fixed-length, variable-length, long content |
| Numeric | INT/BIGINT | IDs, counts |
| Numeric | DECIMAL(p,s) | Money (exact precision) |
| Date | DATE/TIMESTAMP | Always store in UTC |

---

## Indexing Strategy

| Always Index | Why |
|-------------|-----|
| Foreign keys | Speeds up JOINs |
| WHERE clause columns | Speeds up filtering |
| ORDER BY columns | Speeds up sorting |

| Index Type | Best For |
|-----------|----------|
| B-Tree | Range and equality |
| Hash | Exact match only |
| Full-text | Text search |
| Partial | Subset of rows |

**Composite index rule:** Most selective column first, or column most often queried alone.

---

## Constraints

| FK Strategy | Use When |
|------------|----------|
| CASCADE | Dependent data (order_items) |
| RESTRICT | Critical references (prevent accidents) |
| SET NULL | Optional relationships |

---

## Relationship Patterns

| Pattern | Implementation |
|---------|---------------|
| One-to-Many (1:N) | FK in child table with ON DELETE CASCADE |
| Many-to-Many (N:M) | Junction table with composite PK |
| Self-Referential | FK referencing same table |
| Polymorphic | Separate FKs (strong integrity) or Type+ID columns (flexible) |

---

## NoSQL Design (MongoDB)

| Factor | Embed | Reference |
|--------|-------|-----------|
| Access pattern | Read together | Read separately |
| Relationship | 1:few | 1:many |
| Document size | Small | Near 16MB |
| Update frequency | Infrequent | Frequent |

---

## Migrations

| Practice | Why |
|----------|-----|
| Always reversible | Rollbacks happen |
| Backward compatible | Zero-downtime deployment |
| Schema first, data second | Separation of concerns |

**Zero-downtime column addition:** 1) Add nullable column → 2) Deploy code writing to new column → 3) Backfill existing rows → 4) Add NOT NULL constraint.

---

## Performance Optimization

| Technique | When to Use |
|-----------|-------------|
| Add index | Slow WHERE/ORDER BY |
| Denormalize | Expensive JOINs |
| Pagination | Large result sets |
| Caching | Repeated queries |
| Read replica | Read-heavy load |
| Partitioning | Very large tables |
