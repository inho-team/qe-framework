---
name: Qmonitoring-expert
description: Configures monitoring systems, implements structured logging pipelines, creates Prometheus/Grafana dashboards, defines alerting rules, and instruments distributed tracing. Implements Prometheus/Grafana stacks, conducts load testing, performs application profiling, and plans infrastructure capacity. Use when setting up application monitoring, adding observability to services, debugging production issues with logs/metrics/traces, running load tests with k6 or Artillery, profiling CPU/memory bottlenecks, or forecasting capacity needs.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: devops
triggers: monitoring, observability, logging, metrics, tracing, alerting, Prometheus, Grafana, DataDog, APM, performance testing, load testing, profiling, capacity planning, bottleneck
role: specialist
scope: implementation
output-format: code
related-skills: devops-engineer, debugging-wizard, architecture-designer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Monitoring Expert

Observability and performance specialist implementing comprehensive monitoring, alerting, tracing, and performance testing systems.

## Core Workflow

1. **Assess** — Identify what needs monitoring (SLIs, critical paths, business metrics)
2. **Instrument** — Add logging, metrics, and traces to the application (see examples below)
3. **Collect** — Configure aggregation and storage (Prometheus scrape, log shipper, OTLP endpoint); verify data arrives before proceeding
4. **Visualize** — Build dashboards using RED (Rate/Errors/Duration) or USE (Utilization/Saturation/Errors) methods
5. **Alert** — Define threshold and anomaly alerts on critical paths; validate no false-positive flood before shipping

## Quick-Start Examples

### Structured Logging (Node.js / Pino)
```js
import pino from 'pino';

const logger = pino({ level: 'info' });

// Good — structured fields, includes correlation ID
logger.info({ requestId: req.id, userId: req.user.id, durationMs: elapsed }, 'order.created');

// Bad — string interpolation, no correlation
console.log(`Order created for user ${userId}`);
```

### Prometheus Metrics (Node.js)
```js
import { Counter, Histogram, register } from 'prom-client';

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

// Instrument a route
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => {
    httpRequests.inc({ method: req.method, route: req.path, status: res.statusCode });
    end();
  });
  next();
});

// Expose scrape endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### OpenTelemetry Tracing (Node.js)
```js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://jaeger:4318/v1/traces' }),
});
sdk.start();

// Manual span around a critical operation
const tracer = trace.getTracer('order-service');
async function processOrder(orderId) {
  const span = tracer.startSpan('order.process');
  span.setAttribute('order.id', orderId);
  try {
    const result = await db.saveOrder(orderId);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}
```

### Prometheus Alerting Rule
```yaml
groups:
  - name: api.rules
    rules:
      - alert: HighErrorRate
        expr: |
          rate(http_requests_total{status=~"5.."}[5m])
          / rate(http_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Error rate above 5% on {{ $labels.route }}"
```

### k6 Load Test
```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // ramp up
    { duration: '5m', target: 50 },   // sustained load
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95th percentile < 500 ms
    http_req_failed:   ['rate<0.01'],  // error rate < 1%
  },
};

export default function () {
  const res = http.get('https://api.example.com/orders');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Logging | `references/structured-logging.md` | Pino, JSON logging |
| Metrics | `references/prometheus-metrics.md` | Counter, Histogram, Gauge |
| Tracing | `references/opentelemetry.md` | OpenTelemetry, spans |
| Alerting | `references/alerting-rules.md` | Prometheus alerts |
| Dashboards | `references/dashboards.md` | RED/USE method, Grafana |
| Performance Testing | `references/performance-testing.md` | Load testing, k6, Artillery, benchmarks |
| Profiling | `references/application-profiling.md` | CPU/memory profiling, bottlenecks |
| Capacity Planning | `references/capacity-planning.md` | Scaling, forecasting, budgets |

## Code Patterns

**Pattern 1: Prometheus Metric Definition**
```yaml
- name: database_query_duration_seconds
  help: Database query execution time
  type: histogram
  labels: [query_type, status]
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5]
```

**Pattern 2: Grafana Dashboard JSON (RED method)**
```json
{
  "title": "API Service",
  "panels": [
    {"title": "Request Rate", "expr": "rate(http_requests_total[5m])"},
    {"title": "Error Rate", "expr": "rate(http_requests_total{status=~'5..'}[5m])"},
    {"title": "P95 Latency", "expr": "histogram_quantile(0.95, http_request_duration_seconds_bucket)"}
  ]
}
```

**Pattern 3: Alert Rule (PromQL)**
```yaml
- alert: HighLatencyP99
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 1
  for: 3m
  labels: {severity: warning}
  annotations: {summary: "P99 latency above 1s"}
```

## Comment Template

```yaml
# Metric naming: {namespace}_{subsystem}_{name}_{unit}
# Labels (low cardinality): job, instance, method, status
# Avoid: user_id, request_id, session_token (high cardinality)
# Config example:
scrape_configs:
  - job_name: 'api'
    static_configs:
      - targets: ['localhost:8080']  # Single instance
    scrape_interval: 15s              # Adjust per load; avoid <5s
```

## Lint Rules

**promtool check**
```bash
promtool check rules alerting_rules.yml
promtool check config prometheus.yml
```

**yamllint for configs**
```bash
yamllint -d '{rules: {line-length: {max: 120}}}' *.yml
```

**jsonnet lint for dashboards**
```bash
jsonnetfmt --check dashboards/*.jsonnet
```

## Security Checklist

1. **Cardinality Control**: Audit label combinations; set `metric_relabel_configs` to drop high-cardinality labels (e.g., user_id).
2. **Dashboard Access**: Restrict Grafana admin panel; enforce RBAC per team.
3. **No Sensitive Data in Labels**: Never emit passwords, API keys, or PII; mask IDs if needed.
4. **TLS for Scrape**: Use `scheme: https` and `tls_config` in Prometheus scrape configs.
5. **Alert Routing Security**: Require auth on Alertmanager routes; validate webhook receivers (no open POST endpoints).

## Anti-patterns

| Wrong | Correct |
|-------|---------|
| Label: `user_id=12345` (high cardinality) | Label: `user_type=premium` (low cardinality) |
| Alert: `up{instance=...} == 0` (symptom) | Alert: `rate(errors_total[5m]) > threshold` (root cause) |
| Alert with no runbook link | Alert with `annotations.runbook_url` pointing to on-call guide |
| 50+ dashboards per team (sprawl) | 1 service dashboard + shared platform dashboard |
| Scrape every second (storage overhead) | Scrape 30s–60s (adjust per SLA, not per moment) |

## Constraints

### MUST DO
- Use structured logging (JSON)
- Include request IDs for correlation
- Set up alerts for critical paths
- Monitor business metrics, not just technical
- Use appropriate metric types (counter/gauge/histogram)
- Implement health check endpoints
- Control metric cardinality; audit before shipping

### MUST NOT DO
- Log sensitive data (passwords, tokens, PII)
- Alert on every error (alert fatigue)
- Use string interpolation in logs (use structured fields)
- Skip correlation IDs in distributed systems
- Emit unbounded high-cardinality labels (user IDs, session tokens)
