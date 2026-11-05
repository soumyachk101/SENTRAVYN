# SENTRAVYN — Staging Infrastructure (Terraform, AWS)

Reviewed skeleton for the staging AWS stack: VPC/subnets/security groups,
managed RDS PostgreSQL (PostGIS intended), ElastiCache Redis, S3, an ACM
placeholder, an ECS Fargate compute skeleton, and an OIDC role-trust for the
CI-triggered deploy.

## Status: NOTHING IS DEPLOYED

This module is code only. It is **not** applied anywhere and no AWS resources
are created by it:

- There is no AWS account, no credentials, and no cloud access in the dev or
  CI environment for this branch.
- `terraform apply` is never run here.
- Gate F (evidence) deployment status: **NOT RUN / not deployed.** Do not
  interpret this file as evidence of any live infrastructure, any domain, or
  any issued certificate. The ACM resource is intentionally left commented
  out pending a real, owner-controlled domain (docs/BRAND-NAMING.md,
  docs/SEO-AEO-GEO.md).

## Validate locally (the only thing you should run)

From this directory:

```sh
terraform init -backend=false
terraform validate
```

- `init -backend=false` downloads the pinned providers (`hashicorp/aws`
  6.72.0) without needing a backend or credentials, and writes
  `.terraform.lock.hcl`.
- `validate` checks the configuration's syntax and internal consistency.

Both commands require no AWS credentials and do not touch any account. A
`terraform plan` / `apply` would require (a) real credentials, (b) a remote
backend, and (c) owner approval — none of which are part of this skeleton.

## No secrets

No secrets, keys, tokens, or credentials are stored in this module or in
`.tfvars.example`. The deploy path is OIDC-based (see `oidc.tf`): CI asserts
its runner token against the `terraform_deploy` role and no long-lived AWS
credentials are committed. Fill `terraform.tfvars` (never checked in) with
deploy-owned values at provisioning time.

## What is a placeholder vs. real

| Item | State |
|---|---|
| VPC / subnets / security groups | Reviewed placeholder (CIDRs are examples) |
| RDS PostgreSQL + PostGIS param group | Reviewed; PostGIS enabled via `rds_enable_postgis` + reviewed DDL (ADR-004) |
| ElastiCache Redis 7.1 | Reviewed placeholder (small node type) |
| S3 bucket (versioned, encrypted, private) | Reviewed placeholder |
| ACM certificate | **Intentionally commented out** — pending a real domain |
| ECS cluster + task + service | Reviewed skeleton; container image is a placeholder |
| OIDC deploy role | Reviewed trust-policy stub, no wildcard grants |

## Files

- `providers.tf` — pinned AWS provider + region + default tags
- `locals.tf` / `variables.tf` — naming, CIDRs, engine placeholders
- `networking.tf` — VPC, app/db subnets, app/db security groups
- `database.tf` — RDS PostgreSQL + PostGIS parameter group
- `cache.tf` — ElastiCache Redis
- `storage.tf` — S3 (versioned, encrypted, public access blocked)
- `certificate.tf` — ACM placeholder (commented out, pending domain)
- `compute.tf` — ECS Fargate cluster/task/service + least-privilege roles
- `images.tf` — container image / service-count placeholders
- `oidc.tf` — GitHub Actions OIDC deploy role (workflow + branch scoped)
- `terraform.tfvars.example` — example non-secret variable values
