# User Guide: Role-Separated QE Workflow

## What This Is

QE Framework lets you keep a simple command workflow while assigning different runners or model tiers to different roles.

Most users only need:

```text
/Qinit
/Qplan
/Qexecute
/Qexecute -verify
```

## Install

Install QE from a checked-out release tarball:

```text
git clone https://github.com/inho-team/qe-framework.git
cd qe-framework
git checkout v3.0.27
npm pack --cache /tmp/qe-npm-cache
npm install -g ./inho-team-qe-framework-3.0.27.tgz
qe-framework-install
```

## Update

Update QE Framework from the same checkout:

```text
git pull
npm pack --cache /tmp/qe-npm-cache
npm install -g ./inho-team-qe-framework-3.0.27.tgz
qe-framework-install
```

## Basic Usage

### 1. Initialize

Run:

```text
/Qinit
```

During initialization, QE can ask which AI should handle each role.

Typical roles:

- `planner` (creates the plan)
- `implementer` (does the implementation)
- `reviewer` (checks the result independently)
- `supervisor` (makes the final decision)

### 2. Plan

Run:

```text
/Qplan
```

This creates the project planning context and active execution path.

### 3. Execute

Run:

```text
/Qexecute
```

This performs the implementation step.

### 4. Verify

Run:

```text
/Qexecute -verify
```

This performs review, fix loops, and the final verification gate.

## Where Configuration Lives

Advanced users can inspect:

```text
.qe/ai-team/config/team-config.json
```

This file controls role-to-runner mapping, runner execution details, and tiered-model routing policies.

## Where Results Go

QE stores role artifacts in:

```text
.qe/ai-team/artifacts/
```

Key files:

- `role-spec.md`
- `task-bundle.json`
- `implementation-report.md`
- `review-report.md`
- `verification-report.md`

## Recommended Mental Model

You do not need to manage the internal orchestration directly.

Think of QE like this:

- `/Qinit` sets up who does what
- `/Qplan` prepares the work
- `/Qexecute` executes the work
- `/Qexecute -verify` checks whether the work is actually done

This can be done through:

- `hybrid` or `multi-model` for provider-level role separation
- `tiered-model` for one-provider high/medium/low model routing
