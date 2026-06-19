---
skill: Qatomic-run
prompt: "여러 독립 아토믹 항목이 있는 체크리스트를 병렬로 실행해줘"
must_include:
  - "Wave"
  - "file"
must_not_include:
  - "same file in parallel"
rubric: |
  PASS if the response partitions work into waves with non-overlapping file ownership,
  dispatches Haiku teammates, and respects the rule that no two teammates write the same
  file within a wave (offering --worktree isolation when same-file editing is needed).
  FAIL if it ignores file-ownership partitioning or assigns the same file to parallel
  teammates without isolation.
---

Guards the Qatomic-run parallelism contract, including the Phase-2 --worktree isolation
option. Regression target — file-ownership partitioning dropped from the wave model.
