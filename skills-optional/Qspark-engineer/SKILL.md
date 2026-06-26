---
name: Qspark-engineer
description: Use when writing Spark jobs, debugging performance issues, or configuring cluster settings for Apache Spark applications, distributed data processing pipelines, or big data workloads. Invoke to write DataFrame transformations, optimize Spark SQL queries, implement RDD pipelines, tune shuffle operations, configure executor memory, process .parquet files, handle data partitioning, or build structured streaming analytics.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: data-ml
triggers: Apache Spark, PySpark, Spark SQL, distributed computing, big data, DataFrame API, RDD, Spark Streaming, structured streaming, data partitioning, Spark performance, cluster computing, data processing pipeline
role: expert
scope: implementation
output-format: code
related-skills: python-pro, sql-pro, devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Spark Engineer

Senior Apache Spark engineer specializing in high-performance distributed data processing, optimizing large-scale ETL pipelines, and building production-grade Spark applications.

## Core Workflow

1. **Analyze** — Understand data volume, transformations, latency, cluster resources
2. **Design** — Choose DataFrame vs RDD, plan partitioning, identify broadcast opportunities
3. **Implement** — Write Spark code with optimized transforms, caching, error handling
4. **Optimize** — Analyze Spark UI; tune shuffle partitions, eliminate skew, optimize joins
5. **Validate** — Check Spark UI for spill; verify partitions with `df.rdd.getNumPartitions()`

## Code Patterns (3 Examples with Docstrings)

```python
# Pattern 1: Schema-driven DataFrame creation
def create_typed_dataframe(spark, data: list, schema_dict: dict):
    """Create DataFrame with explicit schema and type safety."""
    from pyspark.sql.types import StructType, StructField
    schema = StructType([StructField(k, v, True) for k, v in schema_dict.items()])
    return spark.createDataFrame(data, schema=schema)

# Pattern 2: Broadcast dimension join
def broadcast_dimension_join(large_df, dim_df, join_key: str):
    """Join large fact table with small dimension (<200MB) using broadcast."""
    from pyspark.sql.functions import broadcast
    return large_df.join(broadcast(dim_df), on=join_key, how="left")

# Pattern 3: Safe caching with validation
def cache_with_validation(df, operation_name: str):
    """Cache DataFrame and materialize immediately to detect spill."""
    cached = df.cache()
    row_count = cached.count()  # Materialize now, not later
    print(f"{operation_name}: cached {row_count} rows")
    return cached
```

## Comment Template (Google-style)

```python
def transform_spark_data(df, threshold: float):
    """One-line transformation summary.
    
    Longer: explain Spark strategy, partition assumptions, performance implications.
    
    Args:
        df: Input Spark DataFrame
        threshold: Filtering threshold
    
    Returns:
        Transformed Spark DataFrame
    
    Raises:
        ValueError: If threshold < 0
    """
```

## Lint Rules (ruff/mypy/black)

```toml
[tool.ruff]
line-length = 120
select = ["E", "F", "W", "UP"]
ignore = ["E501"]

[tool.mypy]
python_version = "3.10"
disallow_untyped_defs = true
ignore_missing_imports = true
```

## Security Checklist (5+)

1. **Credential exposure** — Use Kubernetes secrets, IAM roles; never hardcode passwords
2. **Data at rest encryption** — Enable Parquet/Delta encryption; verify storage-level encryption
3. **Access control** — Enforce table/database ACLs; implement row-level security (RLS)
4. **UDF injection** — Never execute user-supplied code; use `pandas_udf` with schema validation
5. **Broadcast secrets** — Don't broadcast PII; validate payload < 2GB; no credentials in broadcast

## Anti-patterns (5 Wrong/Correct)

| Anti-pattern | Fix |
|--------------|-----|
| `df.collect()` on large DataFrame | Use `.limit()`, write to storage, or `.sample(0.1)` |
| No partitioning in ETL | Set `spark.sql.shuffle.partitions = 400` or `repartition(400)` |
| Python UDFs without vectorization | Use `pandas_udf` or Spark SQL `F.col()` functions |
| Caching every intermediate DataFrame | Cache only reused DataFrames; use `.unpersist()` |
| Ignoring Spark UI shuffle metrics | Check UI; if shuffle spill > 10%, adjust partitions/joins |

## Quick Config

```python
spark = SparkSession.builder \
    .config("spark.sql.shuffle.partitions", "400") \
    .config("spark.sql.adaptive.enabled", "true") \
    .config("spark.memory.fraction", "0.8") \
    .getOrCreate()
```

## MUST DO / MUST NOT DO

**MUST:** Define schemas, partition data (200-1000 per core), broadcast small dims, monitor Spark UI, test with prod scale  
**MUST NOT:** Collect large data, skip schema definition, cache everything, ignore shuffle, use plain UDFs on big data
