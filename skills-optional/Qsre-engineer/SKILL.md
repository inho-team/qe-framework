---
name: Qsre-engineer
description: Defines service level objectives, creates error budget policies, designs incident response procedures, develops capacity models, and produces monitoring configurations and automation scripts for production systems. Use when defining SLIs/SLOs, managing error budgets, building reliable systems at scale, incident management, chaos engineering, toil reduction, or capacity planning.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: devops
triggers: SRE, site reliability, SLO, SLI, error budget, incident management, chaos engineering, toil reduction, on-call, MTTR
role: specialist
scope: implementation
output-format: code
related-skills: devops-engineer, cloud-architect, kubernetes-specialist
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# SRE Engineer

## Core Workflow

1. **Assess reliability** - Review architecture, SLOs, incidents, toil levels
2. **Define SLOs** - Identify meaningful SLIs and set appropriate targets
3. **Verify alignment** - Confirm SLO targets reflect user expectations before proceeding
4. **Implement monitoring** - Build golden signal dashboards and alerting
5. **Automate toil** - Identify repetitive tasks and build automation
6. **Test resilience** - Design and execute chaos experiments; verify recovery meets RTO/RPO targets before marking the experiment complete; validate recovery behavior end-to-end

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| SLO/SLI | `references/slo-sli-management.md` | Defining SLOs, calculating error budgets |
| Error Budgets | `references/error-budget-policy.md` | Managing budgets, burn rates, policies |
| Monitoring | `references/monitoring-alerting.md` | Golden signals, alert design, dashboards |
| Automation | `references/automation-toil.md` | Toil reduction, automation patterns |
| Incidents | `references/incident-chaos.md` | Incident response, chaos engineering |

## Constraints

### MUST DO
- Define quantitative SLOs (e.g., 99.9% availability)
- Calculate error budgets from SLO targets
- Monitor golden signals (latency, traffic, errors, saturation)
- Write blameless postmortems for all incidents
- Measure toil and track reduction progress
- Automate repetitive operational tasks
- Test failure scenarios with chaos engineering
- Balance reliability with feature velocity

### MUST NOT DO
- Set SLOs without user impact justification
- Alert on symptoms without actionable runbooks
- Tolerate >50% toil without automation plan
- Skip postmortems or assign blame
- Implement manual processes for recurring tasks
- Deploy without capacity planning
- Ignore error budget exhaustion
- Build systems that can't degrade gracefully

## Output Templates

When implementing SRE practices, provide:
1. SLO definitions with SLI measurements and targets
2. Monitoring/alerting configuration (Prometheus, etc.)
3. Automation scripts (Python, Go, Terraform)
4. Runbooks with clear remediation steps
5. Brief explanation of reliability impact

## Concrete Examples

### SLO Definition & Error Budget Calculation

```
# 99.9% availability SLO over a 30-day window
# Allowed downtime: (1 - 0.999) * 30 * 24 * 60 = 43.2 minutes/month
# Error budget (request-based): 0.001 * total_requests

# Example: 10M requests/month → 10,000 error budget requests
# If 5,000 errors consumed in week 1 → 50% budget burned in 25% of window
# → Trigger error budget policy: freeze non-critical releases
```

### Prometheus SLO Alerting Rule (Multiwindow Burn Rate)

```yaml
groups:
  - name: slo_availability
    rules:
      # Fast burn: 2% budget in 1h (14.4x burn rate)
      - alert: HighErrorBudgetBurn
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[1h]))
            /
            sum(rate(http_requests_total[1h]))
          ) > 0.014400
          and
          (
            sum(rate(http_requests_total{status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          ) > 0.014400
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High error budget burn rate detected"
          runbook: "https://wiki.internal/runbooks/high-error-burn"

      # Slow burn: 5% budget in 6h (1x burn rate sustained)
      - alert: SlowErrorBudgetBurn
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[6h]))
            /
            sum(rate(http_requests_total[6h]))
          ) > 0.001
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Sustained error budget consumption"
          runbook: "https://wiki.internal/runbooks/slow-error-burn"
```

### PromQL Golden Signal Queries

```promql
# Latency — 99th percentile request duration
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))

# Traffic — requests per second by service
sum(rate(http_requests_total[5m])) by (service)

# Errors — error rate ratio
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
  /
sum(rate(http_requests_total[5m])) by (service)

# Saturation — CPU throttling ratio
sum(rate(container_cpu_cfs_throttled_seconds_total[5m])) by (pod)
  /
sum(rate(container_cpu_cfs_periods_total[5m])) by (pod)
```

## Code Patterns

### SLO Definition Template
```yaml
service: api-gateway
slo:
  availability: 99.9%
  latency_p99: 500ms
  error_rate: 0.1%
error_budget:
  monthly_budget: 43.2 minutes downtime
  burn_rate: (errors / total_requests)
  threshold_alert: 2% burned in 1 hour
```

### Error Budget Calculator
```python
def calc_error_budget(slo: float, window_hours: int) -> dict:
    allowed_error = 1 - slo
    minutes = window_hours * 60
    return {"budget_minutes": allowed_error * minutes, "burn_rate_alert": allowed_error * 14.4}
```

### Incident Runbook Template
```
# Incident: [Service] High Error Rate
**Severity:** P1 | **Detection:** [Alert name] | **Duration:** 5 min
**Root Cause:** [To be filled] | **Impact:** [N users, $X revenue]
**Action Plan:**
1. Page on-call engineer
2. Check [service] logs for errors
3. If DB slow: scale replicas / query optimization
4. Verify error budget impact
```

## Comment Template (YAML SLO Config)
```yaml
# SLO config for [service-name]
# Last reviewed: [DATE] | Owner: [team]
service:
  name: api-gateway
  sli_query: sum(rate(http_requests_total{status=~"5.."}[5m]))
  slo:
    availability: 99.9%  # Justification: user-facing API
    latency_p99: 500ms   # Justification: customer expectation
  error_budget_policy:
    - if burn_rate > 14.4x for 1h: freeze non-critical releases
    - if burn_rate > 1x for 6h: declare SEV2, page on-call
```

## Lint Rules

- **promtool validate rules**: Validate Prometheus alert syntax
- **yamllint**: Enforce consistent SLO YAML (2-space indent, no tabs)
- **SLO validation**: Verify all SLOs have SLI queries and burn-rate alerts
- **Runbook links**: All alerts must reference a runbook URL
- **Error budget tracking**: All services must expose error budget metrics

## Security Checklist

1. **Dashboard Access**: Restrict Grafana dashboards to authenticated users; audit access logs weekly
2. **Alert Routing**: Encrypt alert webhook payloads; validate sender IP allowlist; rotate auth tokens monthly
3. **Incident Data**: Classify incident severity; redact PII from logs before storing; encrypt at-rest
4. **On-Call Rotation**: Require MFA for on-call schedule changes; audit escalation paths; 2-person rule for critical overrides
5. **Post-Mortem Confidentiality**: Store documents in access-controlled wiki; require sign-off before publishing; mark sensitive findings [INTERNAL-ONLY]

## Anti-Patterns

1. **Alerting on Uptime, Not SLO**: Alert on 99%+ uptime, not SLO burn rate → misses gradual failures
2. **No Error Budget**: Set SLOs without tracking budget consumption → unbounded failure tolerance
3. **Alert Fatigue**: Create alerts for every metric spike → team ignores alerts, misses real incidents
4. **Toil Over Automation**: Manually restart pods, regenerate certs, scale services → burnout, repeated mistakes
5. **No Post-Mortem Culture**: Skip blameless reviews after incidents → repeating same failures, no learning
