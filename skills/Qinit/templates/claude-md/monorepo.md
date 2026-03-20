# CLAUDE.md

## Project Overview
- **Name**: {{project_name}}
- **Description**: {{project_description}}
- **Monorepo Tool**: {{monorepo_tool}}

## Packages

| Package | Path | Description | Dependencies |
|---------|------|-------------|-------------|
| {{package_name}} | {{package_path}} | {{package_desc}} | {{package_deps}} |

## Build & Run
```bash
# Install all dependencies
{{install_command}}

# Build all packages (in dependency order)
{{build_command}}

# Run specific package
{{run_package_command}}

# Run tests
{{test_command}}
```

## Build Order
1. {{shared_packages}}
2. {{lib_packages}}
3. {{app_packages}}

## Shared Dependencies
| Dependency | Version | Used By |
|-----------|---------|---------|
| | | |

## Project Structure
```
{{project_root}}/
├── packages/
│   ├── {{package_a}}/
│   ├── {{package_b}}/
│   └── {{package_c}}/
├── apps/
│   ├── {{app_a}}/
│   └── {{app_b}}/
└── shared/
    └── {{shared}}/
```

## Constraints
- Do not modify files outside the project scope
- Confirm before destructive actions
- Follow existing code conventions
- Respect package boundaries (no cross-package direct imports without shared dependency)
- Changes to shared packages require testing all dependent packages

## Task Log
- **작업 이력 및 상태**: `.qe/TASK_LOG.md` 참조
