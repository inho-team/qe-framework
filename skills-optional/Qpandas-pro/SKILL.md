---
name: Qpandas-pro
description: Performs pandas DataFrame operations for data analysis, manipulation, and transformation. Use when working with pandas DataFrames, data cleaning, aggregation, merging, or time series analysis. Invoke for data manipulation tasks such as joining DataFrames on multiple keys, pivoting tables, resampling time series, handling NaN values with interpolation or forward-fill, groupby aggregations, type conversion, or performance optimization of large datasets.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: data-ml
triggers: pandas, DataFrame, data manipulation, data cleaning, aggregation, groupby, merge, join, time series, data wrangling, pivot table, data transformation
role: expert
scope: implementation
output-format: code
related-skills: python-pro
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Pandas Pro

Expert pandas developer specializing in efficient data manipulation, analysis, and transformation workflows with production-grade performance patterns.

## Core Workflow

1. **Assess** — Check dtypes, memory, missing values: `df.dtypes`, `df.memory_usage(deep=True).sum()`, `df.isna().sum()`
2. **Design** — Plan vectorized ops, avoid loops, identify indexing strategy
3. **Implement** — Use vectorized methods, method chaining, proper `.loc[]`/`.iloc[]` indexing
4. **Validate** — Assert shapes, null counts, dtypes: `assert result.shape[0] == expected_rows`
5. **Optimize** — Profile memory, apply categorical types, chunk if needed

## Code Patterns (3 Examples with Docstrings)

```python
# Pattern 1: Safe subset update
def safe_subset_update(df: pd.DataFrame, mask: pd.Series, col: str, value):
    """Update column subset without SettingWithCopyWarning."""
    result = df.copy()
    result.loc[mask, col] = value
    return result

# Pattern 2: Grouped aggregation
def grouped_summary(df: pd.DataFrame, group_cols: list, agg_dict: dict):
    """Multi-column groupby with named outputs."""
    return df.groupby(group_cols, observed=True).agg(agg_dict).reset_index()

# Pattern 3: Merge with validation
def validated_merge(left, right, on: list, validate="m:1"):
    """Merge with cardinality check; raises AssertionError on mismatch."""
    result = pd.merge(left, right, on=on, how="left", validate=validate)
    assert result.shape[0] == left.shape[0], "Row count mismatch"
    return result
```

## Comment Template (Google-style)

```python
def process_dataframe(df: pd.DataFrame, threshold: float) -> pd.DataFrame:
    """One-line summary of function purpose.
    
    Longer description: transformation logic, edge cases, assumptions.
    
    Args:
        df: Input DataFrame with columns [col1, col2]
        threshold: Minimum value for filtering
    
    Returns:
        Transformed DataFrame of shape (n_rows, n_cols)
    
    Raises:
        ValueError: If df is empty or threshold < 0
    """
```

## Lint Rules (ruff/mypy/black)

```toml
[tool.ruff]
line-length = 100
select = ["E4", "E7", "E9", "F", "W", "UP"]

[tool.black]
line-length = 100
target-version = ['py39']

[tool.mypy]
python_version = "3.9"
disallow_untyped_defs = true
```

Violations: F841 (unused vars), E501 (line length), W293 (trailing space)

## Security Checklist (5+)

1. **Pickle deserialization** — Never unpickle untrusted data; use `read_parquet()`, `read_csv()`
2. **SQL injection** — Use parameterized: `pd.read_sql("... WHERE id = ?", params=[id])`
3. **Data leakage** — Mask PII before export: `df['email'].str.replace(r'@.*', '@***', regex=True)`
4. **Memory exhaustion** — Validate file size; chunk reads: `pd.read_csv(path, chunksize=10000)`
5. **Type confusion** — Cast untrusted columns: `pd.to_numeric(df['user_id'], errors='coerce')`

## Anti-patterns (5 Wrong/Correct)

| Anti-pattern | Fix |
|--------------|-----|
| `for i, row in df.iterrows()` | Use vectorized `.loc[]`, `.apply()`, or `.assign()` |
| `df['A']['B'] = 1` | Use `.loc[:, 'B'] = 1` or `.copy()` first |
| `df.copy()` in loops | Copy once before loop; use `.copy(deep=False)` if needed |
| `.merge(...).reset_index()` chained | Use `validate` param; assert index match |
| `pd.concat([df1, df2], axis=1)` without index check | Verify `df1.index.equals(df2.index)` first |

## MUST DO / MUST NOT DO

**MUST:** Vectorized ops, proper dtypes, explicit `.copy()` when mutating, data validation checks  
**MUST NOT:** Iterate rows with `.iterrows()`, use chained indexing, assume clean data, ignore SettingWithCopyWarning
