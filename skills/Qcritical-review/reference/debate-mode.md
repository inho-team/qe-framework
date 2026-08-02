# Debate Mode — Structured Debate

## Role

`Qcritical-review --debate <topic>` facilitates a structured debate between
multiple perspectives on a topic. Unlike a one-shot critique, debate mode runs
multi-round back-and-forth with independent agents arguing each side.

## CLI

```text
{adapter.commandPrefix}Qcritical-review --debate <topic>
{adapter.commandPrefix}Qcritical-review --debate <topic> --rounds 5
{adapter.commandPrefix}Qcritical-review --debate <topic> --mode codex-vs-claude
{adapter.commandPrefix}Qcritical-review --debate <topic> --mode agent-vs-agent
{adapter.commandPrefix}Qcritical-review --debate <topic> --mode self-debate
```

`--rounds` defaults to `3` and is capped at `10`.

## Debate Modes

### 1. agent-vs-agent (default)

Two sub-agents are spawned with opposing positions. Each argues independently
without seeing the other's reasoning process.

### 2. codex-vs-claude

Routes one side to Codex (via codex-plugin-cc) and the other to Claude. Gives
genuinely independent perspectives from different models. Falls back to
agent-vs-agent if Codex is unavailable.

### 3. self-debate

The same model argues both sides in alternating turns. Lighter weight but less
independent. Good for quick exploration.

## Execution Procedure

### Step 1: Parse topic and mode

- Extract the debate topic from user input.
- Determine mode (default: agent-vs-agent).
- Determine rounds (default: 3, maximum: 10).

### Step 2: Frame the debate

Present the topic and two positions to the user for confirmation:

```text
Debate: "Should we use a monorepo or multi-repo for this project?"

  Side A (Pro):  Monorepo — shared tooling, atomic changes, unified CI
  Side B (Con):  Multi-repo — independent deploys, clear ownership, smaller scope

  Mode: agent-vs-agent | Rounds: 3

Proceed? [Y/n]
```

The user can adjust sides, mode, or rounds before starting.

### Step 3: Run debate rounds

For agent-vs-agent:

1. Spawn Agent A (sub-agent) with Side A position and full topic context.
2. Spawn Agent B (sub-agent) with Side B position and full topic context.
3. Each round:
   - Agent A presents argument, including rebuttal to the previous round.
   - Agent B presents argument, including rebuttal to the previous round.
   - Display both arguments side by side.
4. Agents run in parallel where possible.

For codex-vs-claude:

1. Check SIVS config and codex-plugin-cc availability.
2. Route Side A to Codex via `getCodexCommand`.
3. Route Side B to Claude (sub-agent).
4. Run rounds as above.

For self-debate:

1. Single agent alternates between sides.
2. Each turn explicitly states which side it is arguing.
3. Must steelman the opposing position before rebutting.

### Step 4: Synthesis

After all rounds, present a synthesis:

```text
Debate Summary
──────────────

Topic: Monorepo vs Multi-repo

Side A strongest points:
  1. ...
  2. ...

Side B strongest points:
  1. ...
  2. ...

Key tradeoffs:
  - ...

Areas of agreement:
  - ...

Unresolved tensions:
  - ...
```

### Step 5: User decision

Ask the user:

- "Which direction are you leaning?"
- "Want another round on a specific point?"
- "Should I draft an ADR (Architecture Decision Record) based on this?"

## Debate Rules

These five rules are enforced on all agents:

1. **Steelman first** — Before rebutting, restate the opponent's strongest point.
2. **Evidence over opinion** — Reference concrete tradeoffs, not preferences.
3. **No strawmanning** — Argue against what was actually said.
4. **Concede valid points** — Acknowledge when the other side is right.
5. **Stay scoped** — Don't drift into tangential topics.

## Will

- Run multi-round structured debates with independent agents.
- Support 3 debate modes: agent-vs-agent, codex-vs-claude, self-debate.
- Produce a balanced synthesis after debate.
- Suggest follow-up actions (ADR, decision doc, etc.).

## Will Not

- Declare a "winner" (the user decides).
- Force a conclusion the user did not reach.
- Run more than 10 rounds (diminishing returns).
- Replace the normal one-shot critical-review mode.
