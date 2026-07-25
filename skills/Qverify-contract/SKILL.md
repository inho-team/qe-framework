---
name: Qverify-contract
user_invocable: false
description: Verify that an implementation and its tests honor a business-logic contract stored under .qe/contracts/active/. Delegates to the Econtract-judge LLM agent on cache miss; returns cached verdict on cache hit. Use when the user says 'verify contract', 'check contract', '/Qverify-contract', or when called from /Qexecute -verify.
---

> **`.qe` reads → DB:** `.qe/` content is stored in the SQLite store (`qe_files`), so a path may have **no file on disk**. Read `.qe/` content with `node scripts/qe-cat.mjs <path>` (or `--ls`/`--exists`) and structured state with `node scripts/qe-query.mjs …` — do not assume the raw file exists. See `QE_CONVENTIONS.md`.

# Contract Verification (Qverify-contract)

## Role

Execute contract conformance verification. Compute a 3-hash (contract/impl/test) cache key; return cached verdict on hit; otherwise invoke the Econtract-judge agent, parse its JSON verdict, cache it, and report.

## Invocation Modes

### `/Qverify-contract <name>` — Verify a Single Contract

**Steps:**

1. Validate `<name>` via `assertValidContractName` from `hooks/scripts/lib/contract-manifest.mjs`. Reject invalid identifiers.

2. Locate contract file via `resolveContractPath(name)` from `hooks/scripts/lib/contract-manifest.mjs`. Contract must be in `active/`; pending contracts are not verified.
   - If contract not found: report `{verdict: "FAIL", summary: "contract not found: {name}"}` and exit.

3. Read contract file content → `contractText`.

4. Use `contract-file-resolver.mjs` functions:
   - `resolveImplPath(name, contractText)` → locate implementation file
   - `resolveTestPath(name, contractText)` → locate test file
   - Read impl file if exists (else `implText = ''`)
   - Read test file if exists (else `testText = ''`)

5. Compute 3-part cache key via `contract-hash.mjs → computeContractHash`:
   - `contract_hash` — SHA256 of contract content
   - `impl_hash` — SHA256 of impl content (or empty string)
   - `test_hash` — SHA256 of test content (or empty string)

6. Call `isCacheHit(name, {contract_hash, impl_hash, test_hash})` from `contract-verdict-cache.mjs`:
   - **Cache HIT** → `readVerdict(name)`, return cached verdict, print report and exit
   - **Cache MISS** → proceed to step 7

7. **Cache MISS flow:**
   - Call `buildJudgePrompt({contractName: name, contractText, implText, testText})` from `contract-judge-prompt.mjs` to construct the prompt
   - Invoke the `Econtract-judge` agent via the Agent tool with `subagent_type: 'Econtract-judge'`, passing the built prompt as the agent's input
   - Parse the agent's output by extracting the **last** ```json code fence (the judge is instructed to emit exactly one; using the last occurrence tolerates accidental earlier example fences without silently accepting a stray first-fence from summary text)
   - If NO ```json fence is found, OR the extracted JSON does not parse, OR the parsed object lacks the required keys (`verdict`, `summary`, `findings`): return `{verdict: "FAIL", summary: "judge returned unparseable output", findings: [{ section: "Judge Output", expected: "single valid JSON verdict fence with verdict/summary/findings", actual: "<first 200 chars of agent output>", severity: "critical" }]}`
   - If MORE than one ```json fence is found: proceed with the last fence's JSON but add a minor finding: `{ section: "Judge Output", expected: "exactly one JSON fence", actual: "N fences found (took the last)", severity: "minor" }` to the parsed findings array before caching
   - On successful parse, enrich the JSON verdict with:
     - `contract_hash` (from step 5)
     - `impl_hash` (from step 5)
     - `test_hash` (from step 5)
     - `judged_at: new Date().toISOString()`
     - `model: "claude-sonnet-4-6"` (or whatever model the agent used)

8. Call `writeVerdict(name, enriched)` from `contract-verdict-cache.mjs` to persist the verdict.

9. Print formatted report (see **Report Format** below) and return the verdict.

### `/Qverify-contract --all` — Verify All Active Contracts

**Steps:**

1. Call `listActive()` from `contract-manifest.mjs` to fetch all active contract names.

2. For each contract name, execute the **single contract flow** (steps 1–9 above).

3. Aggregate results: count PASS vs FAIL verdicts.

4. Print table with columns:
   - `Contract Name` — identifier
   - `Verdict` — PASS or FAIL
   - `Summary` — 1-line verdict summary
   - `Judged At` — ISO timestamp (or "Cached" if from cache)

5. Exit with non-zero status code if any contract verdict is FAIL (enables CI integration).

## Report Format

**Single contract (example):**
```
Contract: sivs-enforcer
Verdict: PASS
Summary: Implementation honors all declared invariants and error modes.
Judged At: 2026-04-22T14:35:00Z

---
Contract: user-service
Verdict: FAIL
Summary: Missing DuplicateEmailError handling.
Findings:
  [critical] Error Modes — expected: throw DuplicateEmailError when email exists | actual: returns null
```

**All contracts (example):**
```
Contract Verification Report (--all)
=====================================

sivs-enforcer    | PASS | Implementation honors all invariants     | Cached
user-service     | FAIL | Missing DuplicateEmailError handling     | 2026-04-22T14:35:00Z
auth-provider    | PASS | Tokens verified correctly                | 2026-04-22T14:36:15Z

Summary: 2 PASS, 1 FAIL
Exit code: 1
```

## Dependencies

This skill depends on the following library modules:

- `hooks/scripts/lib/contract-manifest.mjs` — name validation (`assertValidContractName`), path resolution (`resolveContractPath`), listing (`listActive`)
- `hooks/scripts/lib/contract-file-resolver.mjs` — implementation and test path resolution (`resolveImplPath`, `resolveTestPath`)
- `hooks/scripts/lib/contract-hash.mjs` — 3-hash computation (`computeContractHash`)
- `hooks/scripts/lib/contract-verdict-cache.mjs` — cache operations (`isCacheHit`, `readVerdict`, `writeVerdict`)
- `hooks/scripts/lib/contract-judge-prompt.mjs` — prompt builder (`buildJudgePrompt`)
- `agents/Econtract-judge.md` — LLM judge agent (invoked via Agent tool with `subagent_type: 'Econtract-judge'`)

## Will

- Return structured verdicts (JSON) with hash metadata
- Cache verdicts on successful judge invocation
- Short-circuit on missing contract or unparseable judge output
- Exit non-zero when `--all` detects FAIL verdicts (for CI pipelines)
- Invoke the Econtract-judge agent only on cache miss

## Will Not

- Modify contracts, implementations, or tests
- Attempt automatic fixes
- Emit verdicts without invoking judge on cache miss
- Return verdicts from cache without first checking hash equivalence

## Examples

```
/Qverify-contract sivs-enforcer
→ Verifies .qe/contracts/active/sivs-enforcer.md
→ Locates impl + test files via contract-file-resolver
→ Computes 3 hashes, checks cache
→ On miss: invokes Econtract-judge, caches result, prints report

/Qverify-contract --all
→ Lists all active contracts
→ Verifies each one (in sequence or parallel)
→ Prints table of results
→ Exits non-zero if any FAIL found
```

## Handoff

After contract verification completes, use standard handoff format:

```
Phase 3: Contract Layer — Verification complete

PSE: [x] Plan [x] Spec [x] Execute [>] Verify

Contract: {name} — {verdict}
Next: Continue the active UUID pipeline with `{adapter.commandPrefix}Qexecute -verify {UUID}`; for new work, start with `{adapter.commandPrefix}Qgoal {목표}`.
```
