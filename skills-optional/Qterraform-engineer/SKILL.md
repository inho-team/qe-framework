---
name: Qterraform-engineer
description: Use when implementing infrastructure as code with Terraform across AWS, Azure, or GCP. Invoke for module development (create reusable modules, manage module versioning), state management (migrate backends, import existing resources, resolve state conflicts), provider configuration, multi-environment workflows, and infrastructure testing.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: infrastructure
triggers: Terraform, infrastructure as code, IaC, terraform module, terraform state, AWS provider, Azure provider, GCP provider, terraform plan, terraform apply
role: specialist
scope: implementation
output-format: code
related-skills: cloud-architect, devops-engineer, kubernetes-specialist
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Terraform Engineer

Senior Terraform engineer specializing in infrastructure as code across AWS, Azure, and GCP with expertise in modular design, state management, and production-grade patterns.

## Core Workflow

1. **Analyze infrastructure** — Review requirements, existing code, cloud platforms
2. **Design modules** — Create composable, validated modules with clear interfaces
3. **Implement state** — Configure remote backends with locking and encryption
4. **Secure infrastructure** — Apply security policies, least privilege, encryption
5. **Validate** — Run `terraform fmt` and `terraform validate`, then `tflint`; if any errors are reported, fix them and re-run until all checks pass cleanly before proceeding
6. **Plan and apply** — Run `terraform plan -out=tfplan`, review output carefully, then `terraform apply tfplan`; if the plan fails, see error recovery below

### Error Recovery

**Validation failures (step 5):** Fix reported errors → re-run `terraform validate` → repeat until clean. For `tflint` warnings, address rule violations before proceeding.

**Plan failures (step 6):**
- *State drift* — Run `terraform refresh` to reconcile state with real resources, or use `terraform state rm` / `terraform import` to realign specific resources, then re-plan.
- *Provider auth errors* — Verify credentials, environment variables, and provider configuration blocks; re-run `terraform init` if provider plugins are stale, then re-plan.
- *Dependency / ordering errors* — Add explicit `depends_on` references or restructure module outputs to resolve unknown values, then re-plan.

After any fix, return to step 5 to re-validate before re-running the plan.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Modules | `references/module-patterns.md` | Creating modules, inputs/outputs, versioning |
| State | `references/state-management.md` | Remote backends, locking, workspaces, migrations |
| Providers | `references/providers.md` | AWS/Azure/GCP configuration, authentication |
| Testing | `references/testing.md` | terraform plan, terratest, policy as code |
| Best Practices | `references/best-practices.md` | DRY patterns, naming, security, cost tracking |

## Constraints

### MUST DO
- Use semantic versioning and pin provider versions
- Enable remote state with locking and encryption
- Validate inputs with validation blocks
- Use consistent naming conventions and tag all resources
- Document module interfaces
- Run `terraform fmt` and `terraform validate`

### MUST NOT DO
- Store secrets in plain text or hardcode environment-specific values
- Use local state for production or skip state locking
- Mix provider versions without constraints
- Create circular module dependencies or skip input validation
- Commit `.terraform` directories

## Code Patterns

### Pattern 1: Module with Variables & Outputs
```hcl
# variables.tf
variable "bucket_name" {
  description = "S3 bucket name (3+ chars)"
  type        = string
  validation {
    condition     = length(var.bucket_name) > 3
    error_message = "Must exceed 3 characters"
  }
}

# main.tf
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
  tags   = var.tags
}

# outputs.tf
output "bucket_id" {
  description = "S3 bucket ID"
  value       = aws_s3_bucket.this.id
}
```

### Pattern 2: Remote State Backend (S3 + DynamoDB)
```hcl
terraform {
  backend "s3" {
    bucket         = "my-tf-state"
    key            = "env/prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-lock"
  }
}
```

### Pattern 3: Data Source with Locals
```hcl
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = data.aws_availability_zones.available.names
  common_tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_subnet" "this" {
  for_each            = toset(local.azs)
  availability_zone   = each.value
  tags                = local.common_tags
}
```

## Comment Template

```hcl
# Inline comment: Manages S3 bucket versioning and encryption

/* Block comment:
   Multi-line explanation of module purpose,
   inputs, and expected outputs
*/

variable "enable_logging" {
  description = "Enable CloudWatch logging for all resources"
  type        = bool
  default     = true
}
```

## Lint Rules

**Tools & Commands:**
- `tflint` — Check best practices, naming, complexity
- `terraform validate` — Syntax and provider reference validation
- `terraform fmt` — Auto-format with 2-space indent
- `tfsec` — Security scanning (secrets, IAM misconfigs)

**Config File (.tflint.hcl):**
```hcl
plugin "aws" {
  enabled = true
  version = "0.24.0"
}

rule "terraform_naming_convention" {
  enabled = true
}

rule "terraform_unused_declarations" {
  enabled = true
}
```

## Security Checklist

1. **State File Encryption** — Enable `encrypt = true` in remote backend; use S3 SSE-KMS
2. **No Hardcoded Secrets** — Use `sensitive = true` on variables, inject via env vars or Vault
3. **Least Privilege IAM** — Assume role with minimal permissions; avoid `*` actions
4. **Remote State Locking** — Enable DynamoDB locking to prevent concurrent applies
5. **Module Source Pinning** — Pin git modules to tags/commits; avoid `main` or `HEAD`
6. **Credential Isolation** — Never commit `.tfvars` with secrets; use `.gitignore`

## Anti-patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `bucket = "my-prod-bucket-123"` (hardcoded) | `bucket = var.bucket_name` (variable) |
| No DynamoDB lock table configured | `dynamodb_table = "terraform-lock"` in backend |
| One monolithic `main.tf` (1000+ lines) | Separate `modules/` directory with focused modules |
| Inline provider in `main.tf` | `providers.tf` with version pinning + required_providers |
| `source = "git::https://...?ref=main"` | `source = "git::https://...?ref=v1.0.0"` (pinned tag) |

## Output Format

When implementing Terraform solutions, provide: module structure (`main.tf`, `variables.tf`, `outputs.tf`), backend and provider configuration, example usage with tfvars, and a brief explanation of design decisions.
