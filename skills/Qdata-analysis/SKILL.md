---
name: Qdata-analysis
description: Data exploration, statistical analysis, and visualization. Analyzes CSV/JSON/Excel datasets with distribution profiling, correlation analysis, hypothesis testing, and chart generation. Use for requests like analyze this data, data exploration, 데이터 분석, 통계, statistics, correlation, distribution, visualize, 시각화.
---

> Shared principles: see core/PRINCIPLES.md

# Qdata-analysis — Data Exploration & Statistical Analysis

## Role
A skill that provides structured data analysis workflows for exploring, profiling, and deriving insights from datasets.

## Trigger Conditions
- "analyze this data", "data exploration", "data profiling"
- "statistics", "correlation", "distribution"
- "CSV analysis", "dataset", "visualize data"
- "hypothesis test", "regression", "outliers"

## Supported Formats
- CSV, TSV
- JSON, JSONL
- Excel (.xlsx) via /Qxlsx
- Pandas DataFrames (in Python projects)

## Workflow

### Step 1: Data Profiling
- Row/column count, data types
- Missing value analysis (count, percentage per column)
- Unique value counts and cardinality
- Basic statistics: mean, median, std, min, max, quartiles

### Step 2: Distribution Analysis
- Identify distribution shape per numeric column (normal, skewed, bimodal)
- Detect outliers (IQR method: below Q1-1.5*IQR or above Q3+1.5*IQR)
- Categorical frequency tables with top-N values

### Step 3: Relationship Analysis
- Correlation matrix (Pearson for numeric, Cramer's V for categorical)
- Identify strong correlations (|r| > 0.7)
- Cross-tabulation for categorical pairs

### Step 4: Hypothesis Testing (if applicable)
- t-test: compare means between two groups
- Chi-square: test independence of categorical variables
- ANOVA: compare means across multiple groups
- Report p-value and effect size, not just significance

### Step 5: Visualization Recommendations
Suggest appropriate chart types based on data:
- Distribution: histogram, box plot, violin plot
- Relationship: scatter plot, heatmap
- Comparison: bar chart, grouped bar
- Time series: line chart with trend
- Composition: pie chart (only if < 7 categories), stacked bar

Generate Python code (matplotlib/seaborn) or Mermaid diagrams for visualization.

### Step 6: Insights Summary
- Top 3-5 key findings
- Actionable recommendations
- Data quality issues and limitations
- Suggested next analysis steps

## Analysis Rules
- Always show sample data (first 5 rows) before analysis
- Report confidence intervals, not just point estimates
- Flag data quality issues before drawing conclusions
- Use non-parametric tests when normality assumption is violated
- Round numbers appropriately (2 decimal places for ratios, 0 for counts)

## Will
- Profile and explore datasets
- Calculate descriptive and inferential statistics
- Generate correlation analysis
- Recommend and generate visualizations
- Summarize key insights

## Will Not
- Modify source data files without permission
- Draw causal conclusions from correlational data
- Ignore missing data or outliers without reporting
