# Phase Retrospective — {slug} Phase {N}

> Copy this template to `.qe/planning/plans/{slug}/phases/{N}/RETROSPECTIVE.md`
> and fill in each section before transitioning to the next phase.
> Required by Qplan Step 4 (Post-Execution).

## Phase Report Attachment

Run the phase report command and paste the output path here:

```
node hooks/scripts/lib/ledger.mjs phase-report --slug {slug} --phase {N} --cwd <workspace-root>
```

**Report file:** `.qe/planning/plans/{slug}/reports/PHASE_{N}_REPORT.md`

**Phase report findings summary** (copy from the report's "Summary Findings" section):

- Requirements verdict: <!-- e.g. R003: deferred, R004: deferred, R010: unmeasurable -->
- Overall achievement: <!-- UNVERIFIED | PARTIAL_OR_COMPLETE | NO_GOALS_FOUND -->
- Unresolved items requiring acknowledgement before transition:
  - [ ] <!-- list any unmeasurable/deferred/unknown P0 items and disposition -->

## Achievement Summary

**What was accomplished this phase:**

- <!-- bullet: deliverable + evidence (PR, file path, test result) -->

**What was NOT accomplished (gap tracking):**

- <!-- bullet: item, reason, disposition (deferred/descoped/next-phase) -->

**Decisions made this phase** (reference DECISION_LOG entries):

| Decision ID | Summary | Impact on next phase |
|-------------|---------|----------------------|
| <!-- D-xxx --> | <!-- 1-line --> | <!-- carry-forward constraint --> |

## Lessons Learned

- <!-- what worked well -->
- <!-- what should change next phase -->

## Transition Gate

Before marking this phase complete and moving to the next:

- [ ] Phase report generated and reviewed (`PHASE_{N}_REPORT.md` exists and is non-empty)
- [ ] All P0 requirements either `met`, `deferred` with decision citation, or explicitly acknowledged as `unmeasurable`
- [ ] All MUST-HAVE checklist items complete
- [ ] UAT items signed off (if applicable)
- [ ] This RETROSPECTIVE.md filled in and committed
- [ ] Next phase STATE.md updated with active phase line
