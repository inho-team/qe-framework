---
name: Qsql-pro
description: Optimizes SQL queries, designs database schemas, and troubleshoots performance issues. Use when a user asks why their query is slow, needs help writing complex joins or aggregations, mentions database performance issues, or wants to design or migrate a schema. Invoke for complex queries, window functions, CTEs, indexing strategies, query plan analysis, covering index creation, recursive queries, EXPLAIN/ANALYZE interpretation, before/after query benchmarking, or migrating queries between database dialects (PostgreSQL, MySQL, SQL Server, Oracle).
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: language
triggers: SQL optimization, query performance, database design, PostgreSQL, MySQL, SQL Server, window functions, CTEs, query tuning, EXPLAIN plan, database indexing
role: specialist
scope: implementation
output-format: code
related-skills: devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# SQL Pro

## Core Workflow

1. **Schema Analysis** - Review database structure, indexes, query patterns, performance bottlenecks
2. **Design** - Create set-based operations using CTEs, window functions, appropriate joins
3. **Optimize** - Analyze execution plans, implement covering indexes, eliminate table scans
4. **Verify** - Run `EXPLAIN ANALYZE` and confirm no sequential scans on large tables; if query does not meet sub-100ms target, iterate on index selection or query rewrite before proceeding
5. **Document** - Provide query explanations, index rationale, performance metrics

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Query Patterns | `references/query-patterns.md` | JOINs, CTEs, subqueries, recursive queries |
| Window Functions | `references/window-functions.md` | ROW_NUMBER, RANK, LAG/LEAD, analytics |
| Optimization | `references/optimization.md` | EXPLAIN plans, indexes, statistics, tuning |
| Database Design | `references/database-design.md` | Normalization, keys, constraints, schemas |
| Dialect Differences | `references/dialect-differences.md` | PostgreSQL vs MySQL vs SQL Server specifics |

## Code Patterns

### Basic: SELECT with JOIN
```sql
-- Purpose: Retrieve customer orders with inline total calculation
-- Parameters: order_date must be parameterized (?1) to prevent SQL injection
-- Expected output: customer_name, order_id, total_amount (sum of line items)
SELECT 
    c.name AS customer_name,
    o.order_id,
    SUM(li.quantity * li.unit_price) AS total_amount
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id
LEFT JOIN line_items li ON o.order_id = li.order_id
WHERE o.order_date > ?1
GROUP BY c.customer_id, c.name, o.order_id;
```

### Error Handling: Transaction with SAVEPOINT
```sql
-- Purpose: Safely process fund transfers with rollback on constraint violation
-- Rollback: ROLLBACK TO sp_transfer; handles duplicate key or insufficient funds
BEGIN TRANSACTION;
    SAVEPOINT sp_transfer;
    UPDATE accounts SET balance = balance - ?1 WHERE account_id = ?2;
    UPDATE accounts SET balance = balance + ?1 WHERE account_id = ?3;
    
    -- Constraint violation triggers automatic rollback to savepoint
    IF @@ERROR <> 0 ROLLBACK TRANSACTION;
COMMIT TRANSACTION;
```

### Advanced: Window Function + CTE
```sql
-- Purpose: Rank employees by salary within department and track running payroll
-- Parameters: department_id filter applied before aggregation
-- Output: Includes salary_rank and cumulative payroll for trend analysis
WITH ranked_dept AS (
    SELECT
        department_id,
        employee_id,
        salary,
        ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) AS salary_rank,
        SUM(salary) OVER (PARTITION BY department_id ORDER BY hire_date) AS running_payroll
    FROM employees
    WHERE department_id = ?1
)
SELECT * FROM ranked_dept WHERE salary_rank <= 10;
```

## Comment Template

### Query Comments
```sql
-- Purpose: Calculate monthly revenue by product category
-- Parameters: start_date (DATE), end_date (DATE) — use parameterized queries (?1, ?2)
-- Expected output: category, month, total_revenue, item_count
-- Dependencies: Requires fact_sales, dim_product, dim_date tables
```

### Procedure/Function Comments
```sql
/*
 * Procedure: sp_reconcile_account_balance
 * Parameters:
 *   @account_id INT — primary key of account to reconcile
 *   @tolerance_amount DECIMAL(10,2) — max allowed variance (default: 0.01)
 * Returns: INT status code (0=success, 1=mismatch, 2=error)
 * Example: EXEC sp_reconcile_account_balance @account_id=42, @tolerance_amount=0.01
 * Side effects: May update reconciliation_log table; rolls back if tolerance exceeded
 */
```

### Migration Comments
```sql
-- Migration: Add encrypted_ssn column to employees table
-- Reason: PII compliance — store social security numbers in encrypted format
-- Rollback: ALTER TABLE employees DROP COLUMN encrypted_ssn;
-- Validation: SELECT COUNT(*) FROM employees WHERE encrypted_ssn IS NULL;
```

## Lint Rules

Run **sqlfluff** for automated formatting and lint checks:
```bash
sqlfluff lint {file} --dialect postgres  # dialect: postgres, mysql, tsql, oracle
sqlfluff fix {file} --dialect postgres   # auto-fix style issues
```

Configure `.sqlfluff` in project root:
```ini
[core]
dialect = postgres
max_line_length = 100

[sqlfluff:rules:capitalisation.keywords]
capitalisation_policy = upper
```

## Security Checklist

- **SQL Injection**: Always use parameterized queries (?1, @param). Never concatenate user input.
- **Privilege Escalation**: Grant minimal GRANT permissions; use role-based access control (RBAC); audit GRANT changes.
- **Data Exposure**: Implement column-level permissions (via views or GRANT); mask PII in non-prod; audit SELECT on sensitive columns.
- **Backup Encryption**: Encrypt backup files at rest; test restore from encrypted backup; log backup locations.
- **Audit Logging**: Enable query audit logging; log DDL changes (CREATE, ALTER, DROP); monitor login failures.

## Anti-patterns

| Pattern | Why Wrong | Correct Approach |
|---------|-----------|------------------|
| `SELECT *` | Unknown cardinality; includes unnecessary columns; breaks schema changes | List explicit columns: `SELECT id, name, email` |
| Implicit JOINs (WHERE clause) | Unclear precedence; hard to maintain | Use explicit `INNER JOIN`, `LEFT JOIN` |
| No index on WHERE columns | Full table scan; slow on large tables | `CREATE INDEX idx_table_column ON table(column)` |
| N+1 in application | One query per row; scales poorly | Batch with `JOIN` or `IN` clause; use aggregation |
| JSON in relational storage | Non-atomic updates; query complexity | Normalize to separate table with FK; use JSONB only for config |
