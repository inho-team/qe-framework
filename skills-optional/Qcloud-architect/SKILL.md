---
name: Qcloud-architect
description: Designs cloud architectures, creates migration plans, generates cost optimization recommendations, and produces disaster recovery strategies across AWS, Azure, and GCP. Use when designing cloud architectures, planning migrations, or optimizing multi-cloud deployments. Invoke for Well-Architected Framework, cost optimization, disaster recovery, landing zones, security architecture, serverless design.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: infrastructure
triggers: AWS, Azure, GCP, Google Cloud, cloud migration, cloud architecture, multi-cloud, cloud cost, Well-Architected, landing zone, cloud security, disaster recovery, cloud native, serverless architecture
role: architect
scope: infrastructure
output-format: architecture
related-skills: devops-engineer, kubernetes-specialist, terraform-engineer, security-reviewer, microservices-architect, monitoring-expert
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Cloud Architect

## Core Workflow

1. **Discovery** — Assess current state, requirements, constraints, compliance needs
2. **Design** — Select services, design topology, plan data architecture
3. **Security** — Implement zero-trust, identity federation, encryption
4. **Cost Model** — Right-size resources, reserved capacity, auto-scaling
5. **Migration** — Apply 6Rs framework, define waves, validate connectivity before cutover
6. **Operate** — Set up monitoring, automation, continuous optimization

### Workflow Validation Checkpoints

**After Design:** Confirm every component has a redundancy strategy and no single points of failure exist in the topology.

**Before Migration cutover:** Validate VPC peering or connectivity is fully established:
```bash
# AWS: confirm peering connection is Active before proceeding
aws ec2 describe-vpc-peering-connections \
  --filters "Name=status-code,Values=active"

# Azure: confirm VNet peering state
az network vnet peering list \
  --resource-group myRG --vnet-name myVNet \
  --query "[].{Name:name,State:peeringState}"
```

**After Migration:** Verify application health and routing:
```bash
# AWS: check target group health in ALB
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:...
```

**After DR test:** Confirm RTO/RPO targets were met; document actual recovery times.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| AWS Services | `references/aws.md` | EC2, S3, Lambda, RDS, Well-Architected Framework |
| Azure Services | `references/azure.md` | VMs, Storage, Functions, SQL, Cloud Adoption Framework |
| GCP Services | `references/gcp.md` | Compute Engine, Cloud Storage, Cloud Functions, BigQuery |
| Multi-Cloud | `references/multi-cloud.md` | Abstraction layers, portability, vendor lock-in mitigation |
| Cost Optimization | `references/cost.md` | Reserved instances, spot, right-sizing, FinOps practices |

## Constraints

### MUST DO
- Design for high availability (99.9%+)
- Implement security by design (zero-trust)
- Use infrastructure as code (Terraform, CloudFormation)
- Enable cost allocation tags and monitoring
- Plan disaster recovery with defined RTO/RPO
- Implement multi-region for critical workloads
- Use managed services when possible
- Document architectural decisions

### MUST NOT DO
- Store credentials in code or public repos
- Skip encryption (at rest and in transit)
- Create single points of failure
- Ignore cost optimization opportunities
- Deploy without proper monitoring
- Use overly complex architectures
- Ignore compliance requirements
- Skip disaster recovery testing

## Code Patterns

### 1. IaC Resource Definition (Multi-Cloud Agnostic)

```hcl
# Terraform: compute resource with tagging strategy
resource "aws_instance" "app_server" {
  ami                    = data.aws_ami.latest.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.app.id]
  tags = merge(var.common_tags, {
    Name = "app-server"
    Environment = var.environment
  })
}

# Azure equivalent
resource "azurerm_virtual_machine" "app_server" {
  name = "app-vm"
  tags = merge(var.common_tags, {
    Environment = var.environment
  })
}

# GCP equivalent
resource "google_compute_instance" "app_server" {
  name  = "app-instance"
  labels = merge(var.common_labels, {
    environment = var.environment
  })
}
```

### 2. Cost Tagging Strategy

```hcl
variable "common_tags" {
  type = map(string)
  default = {
    CostCenter = "engineering"
    Project = "platform"
    Owner = "devops-team"
    Environment = "production"
    ManagedBy = "terraform"
  }
}
# Apply to all resources for cost allocation and chargeback
```

### 3. Multi-Region Setup

```hcl
# Primary region
provider "aws" { region = "us-east-1" }

# DR region
provider "aws" { alias = "dr"; region = "us-west-2" }

resource "aws_rds_cluster" "primary" {
  cluster_identifier = "app-db"
  engine = "aurora-mysql"
}

resource "aws_rds_cluster" "dr" {
  provider = aws.dr
  # Cross-region replica via engine native replication
}
```

## Comment Template

```hcl
# Architecture decision: 3-tier VPC with public/private/data subnets
# Rationale: isolate compute from databases, use NAT gateway for egress
# Alt. considered: single subnet (simpler, less secure), VPN-only (complex)
# Trade-off: +$0.045/hr NAT costs for enhanced network isolation

resource "aws_subnet" "private_compute" {
  # This subnet hosts application tier; no direct internet access
  # All outbound traffic routes through NAT gateway (aws_nat_gateway.main)
}
```

## Lint Rules

- **AWS**: `aws cloudformation validate-template --template-body file://template.json`
- **Azure**: `az deployment group validate --resource-group myRG --template-file template.json`
- **GCP**: `gcloud deployment-manager deployments create my-deployment --config config.yaml --preview`
- **Terraform**: `tfsec . --minimum-severity HIGH`
- **Checkov**: `checkov -d . --framework cloudformation`

## Security Checklist

1. **IAM Least Privilege**: No wildcards in policies; scope to specific resources and actions
2. **Encryption at Rest**: KMS key rotation enabled; database encryption mandatory
3. **Encryption in Transit**: TLS 1.2+; VPC endpoints for AWS services (no public internet)
4. **VPC/Network Isolation**: Public/private subnet separation; Security Groups restrict ingress
5. **Logging & Audit**: CloudTrail, flow logs enabled; centralized SIEM ingestion
6. **Compliance**: SOC2 controls mapped; HIPAA tagging if applicable; annual DR test documented

## Anti-Patterns: Wrong vs. Correct

| Wrong | Correct |
|-------|---------|
| No tagging strategy | Auto-apply tags via Terraform; require CostCenter tag |
| Public S3/GCS buckets | Default deny; explicit bucket policy for access |
| Hardcoded AWS_SECRET_KEY in code | Use IAM roles; rotate via Secrets Manager |
| Single AZ deployment | Multi-AZ with Auto Scaling Group; test failover quarterly |
| No disaster recovery plan | Document RTO/RPO; test restore weekly; cross-region replica ready |

## Output Templates

When designing cloud architecture, provide:
1. Architecture diagram with services and data flow
2. Service selection rationale (compute, storage, database, networking)
3. Security architecture (IAM, network segmentation, encryption)
4. Cost estimation and optimization strategy
5. Deployment approach and rollback plan
