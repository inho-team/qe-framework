---
name: Qchaos-engineer
description: Designs chaos experiments, creates failure injection frameworks, and facilitates game day exercises for distributed systems — producing runbooks, experiment manifests, rollback procedures, and post-mortem templates. Use when designing chaos experiments, implementing failure injection frameworks, or conducting game day exercises. Invoke for chaos experiments, resilience testing, blast radius control, game days, antifragile systems, fault injection, Chaos Monkey, Litmus Chaos.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: devops
triggers: chaos engineering, resilience testing, failure injection, game day, blast radius, chaos experiment, fault injection, Chaos Monkey, Litmus Chaos, antifragile
role: specialist
scope: implementation
output-format: code
related-skills: sre-engineer, devops-engineer, kubernetes-specialist
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Chaos Engineer

## When to Use This Skill

- Designing and executing chaos experiments
- Implementing failure injection frameworks (Chaos Monkey, Litmus, etc.)
- Planning and conducting game day exercises
- Building blast radius controls and safety mechanisms
- Setting up continuous chaos testing in CI/CD
- Improving system resilience based on experiment findings

## Core Workflow

1. **System Analysis** - Map architecture, dependencies, critical paths, and failure modes
2. **Experiment Design** - Define hypothesis, steady state, blast radius, and safety controls
3. **Execute Chaos** - Run controlled experiments with monitoring and quick rollback
4. **Learn & Improve** - Document findings, implement fixes, enhance monitoring
5. **Automate** - Integrate chaos testing into CI/CD for continuous resilience

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Experiments | `references/experiment-design.md` | Designing hypothesis, blast radius, rollback |
| Infrastructure | `references/infrastructure-chaos.md` | Server, network, zone, region failures |
| Kubernetes | `references/kubernetes-chaos.md` | Pod, node, Litmus, chaos mesh experiments |
| Tools & Automation | `references/chaos-tools.md` | Chaos Monkey, Gremlin, Pumba, CI/CD integration |
| Game Days | `references/game-days.md` | Planning, executing, learning from game days |

## Safety Checklist

Non-obvious constraints that must be enforced on every experiment:

- **Steady state first** — define and verify baseline metrics before injecting any failure
- **Blast radius cap** — start with the smallest possible impact scope; expand only after validation
- **Automated rollback ≤ 30 seconds** — abort path must be scripted and tested before the experiment begins
- **Single variable** — change only one failure condition at a time until behaviour is well understood
- **No production without safety nets** — customer-facing environments require circuit breakers, feature flags, or canary isolation
- **Close the loop** — every experiment must produce a written learning summary and at least one tracked improvement

## Output Templates

When implementing chaos engineering, provide:
1. Experiment design document (hypothesis, metrics, blast radius)
2. Implementation code (failure injection scripts/manifests)
3. Monitoring setup and alert configuration
4. Rollback procedures and safety controls
5. Learning summary and improvement recommendations

## Code Patterns: Chaos Experiment Definition

### Litmus ChaosEngine Baseline
```yaml
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: {{ experiment_name }}
  namespace: {{ target_namespace }}
spec:
  appinfo:
    appns: {{ namespace }}
    applabel: "{{ selector }}"
    appkind: deployment
  engineState: active
  chaosServiceAccount: litmus-admin
  experiments:
    - name: {{ chaos_type }}   # pod-delete, pod-network-latency, cpu-hog
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: "{{ duration_sec }}"
            - name: PODS_AFFECTED_PERC
              value: "{{ max_percent }}"  # Never > 50% in production
            - name: CHAOS_INTERVAL
              value: "{{ interval_sec }}"
```

### Gremlin Container Injection
```bash
gremlin attack launch --type cpu \
  --cpu-capacity 80 \
  --source-gremlin-tag "app:myservice" \
  --use-case resilience-test
```

## Comment Template: Experiment Metadata

Every chaos experiment file must include:
```yaml
# Experiment: {{ name }}
# Hypothesis: If {{ system }} experiences {{ failure mode }}, then {{ behavior }} with {{ metric threshold }}.
# Steady State: {{ baseline_p99_latency }}ms p99, {{ baseline_error_rate }}% errors, {{ baseline_cpu }}% CPU.
# Blast Radius: Max {{ max_percent }}% replicas | Blast timeout: {{ timeout }}s | Rollback: Automatic
# Impact: {{ blast_scope }} (e.g., "one pod in us-east-1 only")
# Approval: {{ approval_required | true/false }} | Lead: {{ contact }}
# Metrics to Watch: {{ metric_1 }}, {{ metric_2 }}, {{ metric_3 }}
```

## Lint Rules: YAML Validation & Schema

Validate every experiment manifest:

1. **Schema check**: `PODS_AFFECTED_PERC ≤ 50` (prod) or `≤ 80` (staging)
2. **Duration cap**: `TOTAL_CHAOS_DURATION ≤ 300` seconds without explicit approval
3. **Rollback defined**: Must have `CHAOS_KILL_COMMAND` or equivalent abort logic
4. **Namespace isolation**: Experiments must target explicit namespace, never `--all-namespaces`
5. **Resource limits**: Pod limits must be set; no unbounded chaos (e.g., CPU hog capped at 80%)

**Tool**: Validate with `kubeconform` + custom YAML linter for blast radius rules.

## Security Checklist (5+ Items)

Every experiment must pass before execution:

- [x] **Blast Radius Control**: Max affected resource % documented and ≤ 50% for production
- [x] **Rollback Plan**: Automatic abort script tested; manual override procedure documented
- [x] **Approval Gates**: Prod experiments require tech lead or SRE sign-off; staging auto-approved
- [x] **No Prod Without Backup**: Production experiments require fresh DB backup and point-in-time recovery window
- [x] **Audit Trail**: Experiment run logged with operator, start/end time, metrics, and verdict in experiment tracking system
- [x] **Canary First**: Always test in staging/canary with same config before production

## Anti-Patterns (5: To Avoid)

1. **Chaos Without Hypothesis** — Running random failures without a measurable prediction. *Leads to: surprises, unmapped failure modes, wasted time.*
2. **No Rollback Strategy** — Assuming systems self-heal or relying on manual fixes. *Leads to: cascading failures, extended customer impact.*
3. **Testing in Prod Without Safeguards** — Injecting failures during peak hours or without circuit breakers. *Leads to: real incidents blamed on "experiments".*
4. **Random Failures vs Targeted** — Killing random pods instead of specific critical ones. *Leads to: missing weak links, false confidence.*
5. **No Metrics During Experiment** — Assuming "no errors" means "resilient". *Leads to: latency spikes, resource exhaustion, undetected degradation.*
