# CLAUDE.md

## Project Overview
- **Name**: {{project_name}}
- **Description**: {{project_description}}
<!-- if: monorepo -->
- **Monorepo Tool**: {{monorepo_tool}}
<!-- end: monorepo -->

## Tech Stack
<!-- if: minimal -->
- {{tech_stack}}
<!-- end: minimal -->
<!-- if: standard -->
- **Tech Stack**: {{tech_stack}}
<!-- end: standard -->
<!-- if: fullstack -->

### Frontend
- **Framework**: {{frontend_framework}}
- **Language**: {{frontend_language}}
- **Styling**: {{styling_solution}}

### Backend
- **Framework**: {{backend_framework}}
- **Language**: {{backend_language}}
- **Runtime**: {{runtime}}

### Database
- **Primary**: {{primary_db}}
- **Cache**: {{cache_db}}
- **ORM**: {{orm}}
<!-- end: fullstack -->

<!-- if: monorepo -->
## Packages

| Package | Path | Description | Dependencies |
|---------|------|-------------|-------------|
| {{package_name}} | {{package_path}} | {{package_desc}} | {{package_deps}} |
<!-- end: monorepo -->

<!-- if: standard+ -->
## Build & Run
```bash
<!-- if: standard -->
# Install dependencies
{{install_command}}

# Run development server
{{dev_command}}

# Run tests
{{test_command}}
<!-- end: standard -->
<!-- if: fullstack -->
# Frontend
{{frontend_install}}
{{frontend_dev}}

# Backend
{{backend_install}}
{{backend_dev}}

# Database
{{db_setup}}
<!-- end: fullstack -->
<!-- if: monorepo -->
# Install all dependencies
{{install_command}}

# Build all packages (in dependency order)
{{build_command}}

# Run specific package
{{run_package_command}}

# Run tests
{{test_command}}
<!-- end: monorepo -->
```
<!-- end: standard+ -->

<!-- if: monorepo -->
## Build Order
1. {{shared_packages}}
2. {{lib_packages}}
3. {{app_packages}}

## Shared Dependencies
| Dependency | Version | Used By |
|-----------|---------|---------|
| | | |
<!-- end: monorepo -->

<!-- if: fullstack -->
## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| | | |
<!-- end: fullstack -->

<!-- if: standard+ -->
## Project Structure
```
<!-- if: standard -->
{{project_structure}}
<!-- end: standard -->
<!-- if: fullstack -->
{{project_root}}/
├── frontend/        # Frontend application
├── backend/         # Backend API server
├── shared/          # Shared types and utilities
└── infra/           # Infrastructure configuration
<!-- end: fullstack -->
<!-- if: monorepo -->
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
<!-- end: monorepo -->
```
<!-- end: standard+ -->

## Constraints
- Do not modify files outside the project scope
- Confirm before destructive actions
<!-- if: standard+ -->
- Follow existing code conventions
<!-- end: standard+ -->
<!-- if: fullstack -->
- Frontend and backend changes should be coordinated
<!-- end: fullstack -->
<!-- if: monorepo -->
- Respect package boundaries (no cross-package direct imports without shared dependency)
- Changes to shared packages require testing all dependent packages
<!-- end: monorepo -->

<!-- if: standard+ -->
## Goals
- {{goals}}
<!-- end: standard+ -->

<!-- if: fullstack -->
## Environment Variables
| Variable | Purpose | Location |
|----------|---------|----------|
| | | |
<!-- end: fullstack -->

## Task Log
- **작업 이력 및 상태**: `.qe/TASK_LOG.md` 참조
