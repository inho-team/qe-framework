---
name: Qml-pipeline
description: "Designs and implements production-grade ML pipeline infrastructure: configures experiment tracking with MLflow or Weights & Biases, creates Kubeflow or Airflow DAGs for training orchestration, builds feature store schemas with Feast, deploys model registries, and automates retraining and validation workflows. Use when building ML pipelines, orchestrating training workflows, automating model lifecycle, implementing feature stores, managing experiment tracking systems, setting up DVC for data versioning, tuning hyperparameters, or configuring MLOps tooling like Kubeflow, Airflow, MLflow, or Prefect."
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: data-ml
triggers: ML pipeline, MLflow, Kubeflow, feature engineering, model training, experiment tracking, feature store, hyperparameter tuning, pipeline orchestration, model registry, training workflow, MLOps, model deployment, data pipeline, model versioning
role: expert
scope: implementation
output-format: code
related-skills: devops-engineer, kubernetes-specialist, cloud-architect, python-pro
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# ML Pipeline Expert

Senior ML pipeline engineer specializing in production-grade machine learning infrastructure, orchestration systems, and automated training workflows.

## Core Workflow

1. **Design** — Map data flow, identify stages, define component interfaces
2. **Validate** — Run schema & distribution checks before training; halt on failures
3. **Feature** — Build transformation pipelines, feature stores, validation checks
4. **Orchestrate** — Configure distributed training, hyperparameter tuning, resource allocation
5. **Track** — Log metrics, parameters, artifacts; enable comparison & reproducibility
6. **Validate & Deploy** — Implement evaluation gates; run A/B testing before promotion

## Code Patterns (3 Examples with Docstrings)

```python
# Pattern 1: Feature store integration
def build_feature_store(feast_repo_path: str, feature_list: list):
    """Initialize Feast feature store and load features for training."""
    from feast import FeatureStore
    fs = FeatureStore(repo_path=feast_repo_path)
    features = fs.get_historical_features(entity_df, features=feature_list)
    return features

# Pattern 2: MLflow experiment logging
def log_training_run(params: dict, metrics: dict, artifacts: list, run_name: str):
    """Log complete training run: params, metrics, model, plots."""
    import mlflow
    with mlflow.start_run(run_name=run_name):
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        for artifact_path in artifacts:
            mlflow.log_artifact(artifact_path)
        return mlflow.active_run().info.run_id

# Pattern 3: Data validation checkpoint
def validate_pipeline_input(df, expected_schema: dict, min_rows: int = 100):
    """Validate data quality before pipeline execution."""
    assert df.shape[0] >= min_rows, f"Insufficient rows: {df.shape[0]} < {min_rows}"
    for col, dtype in expected_schema.items():
        assert col in df.columns, f"Missing column: {col}"
        assert str(df[col].dtype) == dtype, f"Type mismatch {col}: {df[col].dtype} != {dtype}"
    return df
```

## Comment Template (Google-style)

```python
def orchestrate_training_pipeline(config_path: str, experiment_name: str):
    """One-line orchestration strategy summary.
    
    Longer: feature engineering, parallelization, validation gates, registry.
    
    Args:
        config_path: Path to YAML pipeline configuration
        experiment_name: MLflow experiment identifier
    
    Returns:
        Registered model URI from registry
    
    Raises:
        FileNotFoundError: If config not found
        ValueError: If validation gates fail
    """
```

## Lint Rules (ruff/mypy/black)

```toml
[tool.ruff]
line-length = 100
select = ["E", "F", "W", "UP"]

[tool.mypy]
python_version = "3.9"
disallow_untyped_defs = true
ignore_missing_imports = true
```

## Security Checklist (5+)

1. **Model poisoning** — Validate data integrity; use DVC, checksums, distribution shift detection
2. **Data privacy leakage** — Never log raw data; use aggregates + differential privacy
3. **Artifact signing** — Sign model artifacts; enforce signature validation on load
4. **Credential exposure** — Use secrets manager & env vars; never hardcode keys in DAGs
5. **Training-serving skew** — Version feature definitions; validate stats match within tolerance

## Anti-patterns (5 Wrong/Correct)

| Anti-pattern | Fix |
|--------------|-----|
| No experiment tracking; manual CSV logs | Use MLflow, W&B, Neptune for all runs; log params + metrics |
| Skipped validation; train on all data | Run schema checks, train/val split, log held-out test metrics |
| No versioning; "latest" model only | Use DVC for data, Git tags for code, model registry for artifacts |
| Different training & serving code paths | Single feature transform code; validate equivalence in tests |
| Single hyperparameter run; no tuning | Use Ray Tune, Optuna, or grid search; track all runs |

## MLflow Quick Start

```python
import mlflow
import mlflow.sklearn

mlflow.set_experiment("my-experiment")
with mlflow.start_run():
    mlflow.log_params({"n_estimators": 100, "max_depth": 5})
    model.fit(X_train, y_train)
    mlflow.log_metric("accuracy", accuracy_score(y_test, preds))
    mlflow.sklearn.log_model(model, "model", registered_model_name="my-model")
```

## MUST DO / MUST NOT DO

**MUST:** Version all data/code/models (DVC, Git, registry), pin seeds, validate data, log all params, track experiments, sign artifacts  
**MUST NOT:** Train without tracking, skip validation, hardcode credentials, ignore train-serving skew, deploy without evaluation gates
