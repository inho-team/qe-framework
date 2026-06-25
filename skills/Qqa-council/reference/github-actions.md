# QA Council — PR-Trigger Workflow Scaffold

> A skill runs inside a Claude Code session; it cannot *be* the CI runner. What it can do is
> **scaffold** this workflow so the council runs automatically on every PR via
> `anthropics/claude-code-action`. Confirm with the user before writing the file.

## Governance rules baked into the workflow
- **Explorer is tool-locked to browser-only** via `--allowedTools` — the CI runtime is where the
  black-box boundary is *truly* enforced (an in-session `tools:` list is best-effort only).
- Planner / Generator / Healer get code access (they write tests).
- Results post as a **PR comment only**. No auto-merge — humans decide.
- Run only against a **non-production, synthetic-data** environment.

## `.github/workflows/qa-council.yml` (template)

```yaml
name: QA Council
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write   # comment only — NOT merge

jobs:
  qa-council:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - name: Install deps & Playwright
        run: |
          npm ci
          npx playwright install --with-deps chromium

      - name: Start app (synthetic env)
        run: |
          npm run start:test &   # MUST seed synthetic data only, never real PII
          npx wait-on ${{ vars.QA_TARGET_URL }}

      # --- Regression suite (cheap, every PR) ---
      - name: Run regression suite
        run: npx playwright test --reporter=json > pw-results.json || true

      # --- Explorer: black-box, browser tools ONLY (hard isolation) ---
      - name: Explorer (black-box)
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          allowed_tools: "Bash(npx playwright:*),Bash(npx agent-browser:*)"
          # NO Read/Grep/Glob/Edit -> cannot open source. True black-box in CI.
          prompt: |
            You are the Explorer. Black-box explore ${{ vars.QA_TARGET_URL }}.
            Do not read repository source. Probe bad input, auth/permission edges,
            responsive breakpoints, and the guardrail scenarios. Write findings.json.

      # --- Reporter: comment only ---
      - name: Reporter (PR comment)
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          allowed_tools: "Bash(gh:*),Read"
          prompt: |
            You are the Reporter. Read findings.json + pw-results.json. Post ONE
            PR comment: bugs found, tests added, heals applied, guardrail verdicts,
            merge recommendation. Never merge, never push.
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Required repo config
- **Secret:** `ANTHROPIC_API_KEY`.
- **Variable:** `QA_TARGET_URL` — the synthetic-data test environment URL.
- A `start:test` script (or equivalent) that boots the app with **synthetic data only**.

## Adaptation notes
- Swap `chromium` / start command per project stack (still TBD for moimeasy per the design doc).
- For matrixed flows, add a `strategy.matrix` over critical flows.
- Keep Explorer and Reporter as **separate steps** so their tool grants stay isolated.
