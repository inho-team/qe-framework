---
name: Qkubernetes-specialist
description: Use when deploying or managing Kubernetes workloads. Invoke to create deployment manifests, configure pod security policies, set up service accounts, define network isolation rules, debug pod crashes, analyze resource limits, inspect container logs, or right-size workloads. Use for Helm charts, RBAC policies, NetworkPolicies, storage configuration, performance optimization, GitOps pipelines, and multi-cluster management.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: infrastructure
triggers: Kubernetes, K8s, kubectl, Helm, container orchestration, pod deployment, RBAC, NetworkPolicy, Ingress, StatefulSet, Operator, CRD, CustomResourceDefinition, ArgoCD, Flux, GitOps, Istio, Linkerd, service mesh, multi-cluster, cost optimization, VPA, spot instances
role: specialist
scope: infrastructure
output-format: manifests
related-skills: devops-engineer, cloud-architect, sre-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Kubernetes Specialist

## When to Use This Skill

- Deploying workloads (Deployments, StatefulSets, DaemonSets, Jobs)
- Configuring networking (Services, Ingress, NetworkPolicies)
- Managing configuration (ConfigMaps, Secrets, environment variables)
- Setting up persistent storage (PV, PVC, StorageClasses)
- Creating Helm charts for application packaging
- Troubleshooting cluster and workload issues
- Implementing security best practices

## Core Workflow

1. **Analyze requirements** — Understand workload characteristics, scaling needs, security requirements
2. **Design architecture** — Choose workload types, networking patterns, storage solutions
3. **Implement manifests** — Create declarative YAML with proper resource limits, health checks
4. **Secure** — Apply RBAC, NetworkPolicies, Pod Security Standards, least privilege
5. **Validate** — Run `kubectl rollout status`, `kubectl get pods -w`, and `kubectl describe pod <name>` to confirm health; roll back with `kubectl rollout undo` if needed

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Workloads | `references/workloads.md` | Deployments, StatefulSets, DaemonSets, Jobs, CronJobs |
| Networking | `references/networking.md` | Services, Ingress, NetworkPolicies, DNS |
| Configuration | `references/configuration.md` | ConfigMaps, Secrets, environment variables |
| Storage | `references/storage.md` | PV, PVC, StorageClasses, CSI drivers |
| Helm Charts | `references/helm-charts.md` | Chart structure, values, templates, hooks, testing, repositories |
| Troubleshooting | `references/troubleshooting.md` | kubectl debug, logs, events, common issues |
| Custom Operators | `references/custom-operators.md` | CRD, Operator SDK, controller-runtime, reconciliation |
| Service Mesh | `references/service-mesh.md` | Istio, Linkerd, traffic management, mTLS, canary |
| GitOps | `references/gitops.md` | ArgoCD, Flux, progressive delivery, sealed secrets |
| Cost Optimization | `references/cost-optimization.md` | VPA, HPA tuning, spot instances, quotas, right-sizing |
| Multi-Cluster | `references/multi-cluster.md` | Cluster API, federation, cross-cluster networking, DR |

## Constraints

### MUST DO
- Use declarative YAML manifests (avoid imperative kubectl commands)
- Set resource requests and limits on all containers
- Include liveness and readiness probes
- Use secrets for sensitive data (never hardcode credentials)
- Apply least privilege RBAC permissions
- Implement NetworkPolicies for network segmentation
- Use namespaces for logical isolation
- Label resources consistently for organization
- Document configuration decisions in annotations

### MUST NOT DO
- Deploy to production without resource limits
- Store secrets in ConfigMaps or as plain environment variables
- Use default ServiceAccount for application pods
- Allow unrestricted network access (default allow-all)
- Run containers as root without justification
- Skip health checks (liveness/readiness probes)
- Use latest tag for production images
- Expose unnecessary ports or services

## Common YAML Patterns

### Deployment with resource limits, probes, and security context

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: my-namespace
  labels:
    app: my-app
    version: "1.2.3"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
        version: "1.2.3"
    spec:
      serviceAccountName: my-app-sa   # never use default SA
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 2000
      containers:
        - name: my-app
          image: my-registry/my-app:1.2.3   # never use latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          envFrom:
            - secretRef:
                name: my-app-secret   # pull credentials from Secret, not ConfigMap
```

### Minimal RBAC (least privilege)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: my-namespace
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-app-role
  namespace: my-namespace
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list"]   # grant only what is needed
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-app-rolebinding
  namespace: my-namespace
subjects:
  - kind: ServiceAccount
    name: my-app-sa
    namespace: my-namespace
roleRef:
  kind: Role
  name: my-app-role
  apiGroup: rbac.authorization.k8s.io
```

### NetworkPolicy (default-deny + explicit allow)

```yaml
# Deny all ingress and egress by default
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: my-namespace
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
---
# Allow only specific traffic
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-my-app
  namespace: my-namespace
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

## Validation Commands

After deploying, verify health and security posture:

```bash
# Watch rollout complete
kubectl rollout status deployment/my-app -n my-namespace

# Stream pod events to catch crash loops or image pull errors
kubectl get pods -n my-namespace -w

# Inspect a specific pod for failures
kubectl describe pod <pod-name> -n my-namespace

# Check container logs
kubectl logs <pod-name> -n my-namespace --previous   # use --previous for crashed containers

# Verify resource usage vs. limits
kubectl top pods -n my-namespace

# Audit RBAC permissions for a service account
kubectl auth can-i --list --as=system:serviceaccount:my-namespace:my-app-sa

# Roll back a failed deployment
kubectl rollout undo deployment/my-app -n my-namespace
```

## Code Patterns

### Pattern 1: Deployment with Resource Limits
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-prod
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: registry/app:v1.2.3  # use explicit version, never latest
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"  # prevents OOMKill surprises
```

### Pattern 2: HPA Config
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: app-hpa
spec:
  scaleTargetRef:
    kind: Deployment
    name: app-prod
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70  # scale at 70% CPU usage
```

### Pattern 3: NetworkPolicy
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-deny-all
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes: ["Ingress", "Egress"]
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 8080
```

## Comment Template

### YAML Commenting Conventions
```yaml
# purpose: Exposes backend API on port 8080
# constraint: Must use TLS for external traffic
# owner: platform-team
# urgency: critical
# last-reviewed: 2026-04-04
```

### kubectl Annotation Conventions
```yaml
metadata:
  annotations:
    description: "Main application server"
    managed-by: "kustomize"
    runbook: "https://wiki/runbook/app"
```

## Lint Rules

**kubeval**: Validate manifest schema
```bash
kubeval *.yaml
```

**kube-linter**: Check for best practices
```bash
kube-linter lint *.yaml
```

**conftest**: Policy-as-code validation
```bash
conftest test -p policies/*.rego *.yaml
```

**.kube-linter.yaml** config:
```yaml
checks:
  doNotAutoAddDefaults: false
  addAllBuiltIn: true
excludedChecks:
  - "no-extensions-v1beta"
customChecks:
  - name: "require-resource-limits"
    template: "resource-limits"
```

## Security Checklist

1. **Pod Security Standards**: Apply restricted PSS (no privileged, drop all capabilities)
2. **RBAC Least Privilege**: Grant only necessary verbs (get, list) on required resources
3. **Network Policies**: Default-deny ingress/egress; whitelist specific routes
4. **Secret Encryption**: Enable etcd encryption at rest with `--encryption-provider-config`
5. **Image Scanning**: Use Trivy or Syft; block images with critical CVEs
6. **No Privileged Containers**: Set `securityContext.privileged: false` always

## Anti-Patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `image: app:latest` | `image: app:v1.2.3` (pinned semver) |
| No resource limits | `requests.cpu: 100m, limits.cpu: 500m` |
| `runAsUser: 0` (root) | `runAsUser: 1000, runAsNonRoot: true` |
| Secrets in ConfigMaps | Secrets in `Secret` objects with RBAC |
| No readiness probes | Include `readinessProbe.httpGet` with retries |

## Output Templates

When implementing Kubernetes resources, provide:
1. Complete YAML manifests with proper structure
2. RBAC configuration if needed (ServiceAccount, Role, RoleBinding)
3. NetworkPolicy for network isolation
4. Brief explanation of design decisions and security considerations
