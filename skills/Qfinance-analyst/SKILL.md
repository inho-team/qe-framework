---
name: Qfinance-analyst
description: Financial analysis, valuation modeling, and quantitative investment tools. Covers ratio analysis, DCF valuation, Monte Carlo simulation, sensitivity analysis, and portfolio optimization. Use for requests like "financial analysis", "valuation", "DCF", "Monte Carlo", "quant", "investment analysis", "portfolio".
---

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qfinance-analyst — Financial Analysis & Quant Modeling

## Role
A skill that provides structured financial analysis and quantitative modeling workflows.
Covers fundamental analysis, valuation, risk modeling, and investment decision support.

## Trigger Conditions
- "financial analysis", "valuation", "DCF", "Monte Carlo"
- "quant", "quantitative", "investment analysis"
- "ratio analysis", "sensitivity analysis", "portfolio"
- "budget variance", "forecast", "financial model"

## Workflow

### Phase 1: Scoping
1. Define analysis objective (valuation, risk assessment, portfolio optimization, etc.)
2. Identify data sources and required inputs
3. Select analytical framework
4. Establish materiality thresholds

### Phase 2: Analysis Tools

#### Tool 1: Financial Ratio Analysis
Calculate ratios across 5 categories:
- **Profitability**: ROE, ROA, gross margin, operating margin, net margin
- **Liquidity**: current ratio, quick ratio, cash ratio
- **Leverage**: debt-to-equity, interest coverage, debt-to-EBITDA
- **Efficiency**: asset turnover, inventory turnover, receivable days
- **Valuation**: P/E, P/B, EV/EBITDA, dividend yield

#### Tool 2: DCF Valuation
- Project free cash flows (5-10 year horizon)
- Calculate WACC (cost of equity via CAPM + cost of debt)
- Determine terminal value (Gordon Growth or Exit Multiple)
- Compute enterprise value and equity value per share
- Sanity check: implied growth rate, exit multiple reasonableness

#### Tool 3: Monte Carlo Simulation
- Define input distributions (revenue growth, margins, discount rate)
- Run 10,000+ iterations
- Generate probability distributions for key outputs
- Calculate confidence intervals (5th, 25th, 50th, 75th, 95th percentile)
- Report probability of achieving target returns

#### Tool 4: Sensitivity Analysis
- Two-variable data tables (e.g., WACC vs growth rate)
- Tornado chart: rank variables by impact on output
- Identify critical value drivers
- Break-even analysis

#### Tool 5: Portfolio Analysis
- Mean-variance optimization (Markowitz)
- Sharpe ratio calculation
- Correlation matrix analysis
- Risk decomposition (systematic vs idiosyncratic)
- VaR (Value at Risk) estimation

### Phase 3: Output
Generate structured reports:
- Executive summary with key findings
- Detailed analysis with assumptions documented
- Sensitivity tables and scenario comparisons
- Risk assessment and limitations
- Recommendation with confidence level

### Phase 4: Validation
- Cross-check valuations against market multiples
- Verify model consistency (balance sheet balances, cash flow reconciles)
- Test edge cases in Monte Carlo inputs
- Document all assumptions explicitly

## Output Formats
- Markdown report with tables
- Python scripts for reproducible calculations (standard library + numpy/pandas if available)
- Excel-compatible output via /Qxlsx when needed

## Disclaimer
All financial analysis is for educational and research purposes only. Not financial advice.

## Will
- Financial ratio analysis and interpretation
- DCF and valuation modeling
- Monte Carlo simulation and risk analysis
- Sensitivity and scenario analysis
- Portfolio optimization

## Will Not
- Provide specific investment recommendations as financial advice
- Access real-time market data (use user-provided data)
- Replace professional financial advisors
