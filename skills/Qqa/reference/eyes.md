# Eyes — Dual-Engine Browser Layer for Qqa council

Engine-neutral "eyes" for the council's browser-touching roles (Planner, Explorer, Auditor,
Healer). The council runs **identically on Claude and Codex**: both engines drive the live app
through **Playwright MCP**, with the unmodified `scripts/lib/browser-driver.mjs` library as a
programmatic fallback. Regression codification (`*.spec.ts`) is unchanged and out of this layer's
scope.

Implementation: [`scripts/lib/eyes-mcp.mjs`](../../../scripts/lib/eyes-mcp.mjs).
Tests: [`scripts/lib/__tests__/eyes-mcp.test.mjs`](../../../scripts/lib/__tests__/eyes-mcp.test.mjs).

> **Why not native "computer use"?** Codex genuinely has `browser_use`/`computer_use`, but the QE
> framework has no synchronous `codex exec` channel to drive it from the council (codex is an async
> slash-command companion). Both engines instead attach **Playwright MCP** — a real, symmetric
> mechanism. Codex's own `computer-use` MCP server is left for a future extension.

## Engine identity is injected, never detected

`engine` is an **injected parameter** (`claude` | `codex`), not runtime-magic. `interaction_adapter`
only consumes a passed `client`; there is no detection primitive, so the council passes `engine`
explicitly. Env `QE_ACTIVE_CLIENT` is the only fallback. Under a rescue delegation, pin `engine` to
the layer that actually drives the browser. Any other value → typed `INVALID_ENGINE`.

```js
resolveEngine('codex')        // → 'codex'  (throws INVALID_ENGINE otherwise)
```

## Transport resolution (verify → probe → ladder)

`resolveBrowserTransport(engine, { skipProbe, probeTimeoutMs })` walks the ladder:

1. **Identity match** — `verifyMcpIdentity(engine)`. Claude assumes MCP tool presence; Codex parses
   `codex mcp list` and matches the entry whose **command/args contain `@playwright/mcp`** (an entry
   merely *named* `playwright` is rejected — impostor guard).
2. **Real startup probe** — `runStartupProbe({ timeoutMs })` opens `about:blank` and snapshots it to
   prove the browser actually **starts**, not just that it's *registered*. It has a **15 s timeout**
   (`PROBE_TIMEOUT_MS`) and **fails fast with `MCP_START_FAILED` on failure or timeout — it never
   hangs** (the timeout always wins the race even if the underlying driver ignores the abort signal).
3. **Fallback ladder (bounded)** — Playwright MCP (probe passed) → `browser-driver` library
   (`isBrowserAvailable()`) → **typed stop**: `MCP_START_FAILED` / `PLAYWRIGHT_NOT_INSTALLED` /
   `INVALID_ENGINE`. No infinite fallback. A fallback is a *transport* change only and keeps the same
   `evidence/<engine>/` directory.

If Codex has no `@playwright/mcp` entry, surface `generateCodexMcpAddGuidance()` and pause:

```
codex mcp add playwright -- npx @playwright/mcp@<resolved X.Y.Z>
```

The version is **pinned to a concrete X.Y.Z (never `@latest`)** and the resolved version is recorded
to evidence. The command is **guidance only — never auto-executed**; it mutates the user's Codex
config, so it requires explicit user confirmation.

## Explicit MCP invocation contract

Roles call Playwright MCP tools by name, not by vibe:

| Purpose | Tool |
|---------|------|
| Navigate to the resolved URL | `browser_navigate` |
| Accessibility tree (black-box assertions) | `browser_snapshot` |
| Evidence screenshot | `browser_take_screenshot` |
| Console capture | `browser_console_messages` |

A tool error or `MCP_START_FAILED` triggers the fallback ladder — never a silent skip.
Black-box contract holds on both engines: MCP browser tools observe the running app only and must
**not** read repository source.

## 3-state liveness receipt

`createLivenessReceipt(engine, evidenceDir)` writes `receipt.json` **incrementally** so a crash
before `flush()` leaves `not_run` — never misread as a clean pass.

```jsonc
{
  "engine": "codex",
  "probes_run": 3,
  "assertions_run": 12,
  "findings_count": 0,
  "terminal_state": "ran_no_findings"   // stamped only at flush()
}
```

`terminal_state ∈ { unavailable, not_run, ran_no_findings, ran_with_findings }`. This is the guard
against the green-suite-hides-broken failure mode: an **empty findings list is only "clean" when
`terminal_state === "ran_no_findings"`**; `unavailable` (no engine) and `not_run` (soft no-op — nav
timeout, blank SPA shell) are distinct states.

## Per-capture safety gate

`assertNonProdUrl(resolvedUrl, { allowProd })` re-runs the non-production check on the resolved
`page.url()` **before every evidence capture** — not once at navigation. This blocks server 3xx,
SPA client-side redirects, and prod-origin iframes that land the browser on production *after* the
initial gate. Applies on both engines. Production / real-PII → hard stop.

## Evidence namespacing

`buildEvidenceDir(engine, runId, baseDir)` produces `evidence/<engine>/<runId>/`. Engine identity is
**pinned once at run start**; a mid-run transport fallback keeps the same directory so a single
logical run never splits its artifacts across two engine folders.

## Entry point

`initEyesMcp({ engine, ... })` ties the above together for the council: validate engine → resolve
transport → build evidence dir → open the liveness receipt. See the source for the exact signature.
