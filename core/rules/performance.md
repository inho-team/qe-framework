# Performance Rules -- Execution-Level Checklist

> Referenced by: Ecode-reviewer

Complements PRINCIPLES.md "Code Quality Principles". This file provides performance-specific checks.

## N+1 Query Detection

- [ ] List/collection endpoints do not query inside loops
- [ ] Related data is fetched via JOIN, eager loading, or batch query
- [ ] ORM lazy-loading is disabled or explicitly controlled in list contexts

## Unnecessary Re-renders (React / UI)

- [ ] Components do not re-render on every parent render (use React.memo where appropriate)
- [ ] useEffect dependencies are correct (no missing or extra deps)
- [ ] Large lists use virtualization (react-window, react-virtualized)
- [ ] Context providers are scoped to minimize consumer re-renders

## Memory Leak Patterns

- [ ] Event listeners are cleaned up on unmount/dispose
- [ ] Intervals and timeouts are cleared
- [ ] Subscriptions (WebSocket, Observable) are unsubscribed
- [ ] Large objects are dereferenced when no longer needed
- [ ] Closures do not capture large scopes unnecessarily

## Lazy Loading

- [ ] Heavy modules are dynamically imported (code splitting)
- [ ] Images use lazy loading (`loading="lazy"` or Intersection Observer)
- [ ] Below-the-fold content is deferred

## Caching Strategies

- [ ] Frequently accessed, rarely changed data is cached
- [ ] Cache invalidation strategy is defined (TTL, event-based, version-based)
- [ ] HTTP caching headers are configured (Cache-Control, ETag)
- [ ] Database query results are cached where appropriate (with invalidation)

## General

- [ ] No synchronous blocking operations in async/event-loop code
- [ ] Batch operations preferred over individual operations in loops
- [ ] Pagination used for large data sets
- [ ] Compression enabled for API responses
