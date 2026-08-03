# Qexecute Autonomy and State Contract

## Utopia modifier

`-utopia` combines with default or `-verify`. It skips reversible confirmation,
uses the documented recommended default, and stops on destructive ambiguity.
`-ralph` repeats incomplete work only; it does not weaken verification or safety
gates. `off` disables autonomous continuation and `status` is read-only.

## State and safety

The hook-owned state contract remains authoritative. Resolve the active task
from `.qe/TASK_LOG.md` and task/checklist artifacts, never from conversational
memory alone. Before changes, inspect the worktree and preserve unrelated user
edits. Do not mutate version or release state outside Qrelease, and route commits
through Qcommit.

The PreToolUse hook owns build admission and protected capability checks. Wait
and retry when admission is busy; never bypass it. Autonomous mode cannot
approve destructive cleanup, external publication, credential changes, or an
unbounded scope expansion.

## Multiple UUIDs

Multiple UUIDs are independent top-level tasks. Validate each pair, reject
shared write ownership, and otherwise execute them as a bounded wave. A failed
task does not erase successful evidence from another task.

## Completion and handoff

Mark both documents complete, write the completed destinations and verify them
before removing their in-progress sources, update TASK_LOG, and reset loop
counters. Leave completed pairs for the deterministic Stop-hook archive sweep.
Report UUID, changed files, verification, residual risks, assumptions, and the
next pending task; do not expose raw internal PSE commands to the user.
