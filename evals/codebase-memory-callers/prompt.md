---
description: 'QE 디버깅에서 실제 코드 그래프로 호출 경로를 찾는지'
tags: [codebase-memory]
runs: 3
max_turns: 12
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Skill, ToolSearch, mcp__plugin_qe-framework_codebase-memory-mcp__list_projects, mcp__plugin_qe-framework_codebase-memory-mcp__index_repository, mcp__plugin_qe-framework_codebase-memory-mcp__trace_path]
---

`normalizeAmount`가 일부 청구서에서 예상과 다른 값을 반환해. Qdebugging으로 조사해 줘. 현재 작업 공간의 코드 그래프에서 이 함수의 직접 호출자를 찾아, 실제 소스에서 확인한 파일과 함수 이름을 알려줘. 인덱스가 없으면 이 작업 공간만 `fast` 모드로 인덱싱해 줘. 소스는 수정하지 마.
