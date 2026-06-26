---
name: Qmicroservices-architect
description: Designs distributed system architectures, decomposes monoliths into bounded-context services, recommends communication patterns, and produces service boundary diagrams and resilience strategies. Use when designing distributed systems, decomposing monoliths, or implementing microservices patterns — including service boundaries, DDD, saga patterns, event sourcing, CQRS, service mesh, or distributed tracing.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: api-architecture
triggers: microservices, service mesh, distributed systems, service boundaries, domain-driven design, event sourcing, CQRS, saga pattern, Kubernetes microservices, Istio, distributed tracing
role: architect
scope: system-design
output-format: architecture
related-skills: devops-engineer, kubernetes-specialist, graphql-architect, architecture-designer, monitoring-expert
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Microservices Architect

Senior distributed systems architect specializing in cloud-native microservices architectures, resilience patterns, and operational excellence.

## Core Workflow

1. **Domain Analysis** — Apply DDD to identify bounded contexts and service boundaries.
   - *Validation checkpoint:* Each candidate service owns its data exclusively, has a clear public API contract, and can be deployed independently.
2. **Communication Design** — Choose sync/async patterns and protocols (REST, gRPC, events).
   - *Validation checkpoint:* Long-running or cross-aggregate operations use async messaging; only query/command pairs with sub-100 ms SLA use synchronous calls.
3. **Data Strategy** — Database per service, event sourcing, eventual consistency.
   - *Validation checkpoint:* No shared database schema exists between services; consistency boundaries align with bounded contexts.
4. **Resilience** — Circuit breakers, retries, timeouts, bulkheads, fallbacks.
   - *Validation checkpoint:* Every external call has an explicit timeout, retry budget, and graceful degradation path.
5. **Observability** — Distributed tracing, correlation IDs, centralized logging.
   - *Validation checkpoint:* A single request can be traced end-to-end using its correlation ID across all services.
6. **Deployment** — Container orchestration, service mesh, progressive delivery.
   - *Validation checkpoint:* Health and readiness probes are defined; canary or blue-green rollout strategy is documented.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Service Boundaries | `references/decomposition.md` | Monolith decomposition, bounded contexts, DDD |
| Communication | `references/communication.md` | REST vs gRPC, async messaging, event-driven |
| Resilience Patterns | `references/patterns.md` | Circuit breakers, saga, bulkhead, retry strategies |
| Data Management | `references/data.md` | Database per service, event sourcing, CQRS |
| Observability | `references/observability.md` | Distributed tracing, correlation IDs, metrics |

## Implementation Examples

### Correlation ID Middleware (Node.js / Express)
```js
const { v4: uuidv4 } = require('uuid');

function correlationMiddleware(req, res, next) {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  // Attach to logger context so every log line includes the ID
  req.log = logger.child({ correlationId: req.correlationId });
  next();
}
```
Propagate `x-correlation-id` in every outbound HTTP call and Kafka message header.

### Circuit Breaker (Python / `pybreaker`)
```python
import pybreaker

# Opens after 5 failures; resets after 30 s in half-open state
breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)

@breaker
def call_inventory_service(order_id: str):
    response = requests.get(f"{INVENTORY_URL}/stock/{order_id}", timeout=2)
    response.raise_for_status()
    return response.json()

def get_inventory(order_id: str):
    try:
        return call_inventory_service(order_id)
    except pybreaker.CircuitBreakerError:
        return {"status": "unavailable", "fallback": True}
```

### Saga Orchestration Skeleton (TypeScript)
```ts
// Each step defines execute() and compensate() so rollback is automatic.
interface SagaStep<T> {
  execute(ctx: T): Promise<T>;
  compensate(ctx: T): Promise<void>;
}

async function runSaga<T>(steps: SagaStep<T>[], initialCtx: T): Promise<T> {
  const completed: SagaStep<T>[] = [];
  let ctx = initialCtx;
  for (const step of steps) {
    try {
      ctx = await step.execute(ctx);
      completed.push(step);
    } catch (err) {
      for (const done of completed.reverse()) {
        await done.compensate(ctx).catch(console.error);
      }
      throw err;
    }
  }
  return ctx;
}

// Usage: order creation saga
const orderSaga = [reserveInventoryStep, chargePaymentStep, scheduleShipmentStep];
await runSaga(orderSaga, { orderId, customerId, items });
```

### Event-Driven Message Handler (Kafka)
```js
async function handleOrderEventMessage(message) {
  const { type, payload, correlationId } = message;
  logger.info({ correlationId }, `Processing ${type}`);
  try {
    if (type === 'OrderCreated') {
      await reserveInventory(payload.orderId, payload.items);
    } else if (type === 'PaymentProcessed') {
      await scheduleShipment(payload.orderId);
    }
    await acknowledgeMessage(message);
  } catch (err) {
    logger.error({ correlationId, err }, 'Event processing failed');
    // Nack for retry or DLQ routing
  }
}
```

## Code Patterns (Microservices Essentials)

1. **Circuit Breaker** — Fail fast when downstream service is degraded; auto-reset after timeout.
2. **Saga Orchestration** — Multi-step distributed transactions with compensating rollback steps.
3. **Event-Driven Handler** — Async message processing with correlation ID propagation and graceful error handling.

## Comment Template

Service documentation (JSDoc / Javadoc):
```
/**
 * OrderService
 * 
 * API Contract:
 * - POST /orders — create order (idempotent: use order-idempotency-key header)
 * - GET /orders/{id} — fetch order details
 * - DELETE /orders/{id} — cancel order (calls compensation saga)
 * 
 * Dependencies: inventory-service (gRPC), payment-service (async event), warehouse-service (REST)
 * SLA: 99.5% uptime; p99 latency <200ms for GET; circuits open after 5 failures.
 * Data: owns Order aggregate; eventual consistency with shipment status.
 */
```

## Lint Rules

- **Language** — Use language-specific linter (reference `lint-commands.md` for eslint/flake8/checkstyle).
- **OpenAPI** — Validate specs with `spectral lint service-spec.yaml`.
- **Docker** — Lint Dockerfile with `hadolint` to enforce security layers, minimize image size.

## Security Checklist

- [ ] Service-to-service auth: mTLS or JWT signed with service private key
- [ ] API gateway enforces rate limiting (per-tenant, per-API-key)
- [ ] Secrets: no hardcoded credentials; use Vault, K8s Secrets, or cloud KMS
- [ ] Network policies: ingress/egress rules restrict inter-service traffic
- [ ] Distributed tracing: instrument for audit; log user actions with correlation ID

## Anti-patterns (Wrong vs. Correct)

| Wrong | Correct |
|-------|---------|
| Distributed monolith: all services call same DB → data coupling | Database per service: each owns its schema; async events sync state |
| Shared database: eliminates transaction boundaries | Service DB + Event Sourcing: consistent within bounded context; eventual consistency across |
| Synchronous chains: A→B→C→D blocks on failures | Async chains: A publishes event; B, C, D subscribe independently with retries |
| No circuit breaker: cascading failures when downstream breaks | Circuit breaker: fail fast, half-open probe, auto-reset after timeout |
| Chatty services: 100 calls per request, network overhead | Coarse-grained boundaries: single call returns composed data; use caching/CQRS |

## Constraints (MUST / MUST NOT)

**MUST:** Domain-driven design boundaries | Database per service | Circuit breakers | Correlation IDs | Async for cross-aggregate | Graceful degradation | Health/readiness probes

**MUST NOT:** Distributed monoliths | Shared DB schemas | Sync long-running calls | Skip distributed tracing | Ignore network failures | Chatty interfaces
