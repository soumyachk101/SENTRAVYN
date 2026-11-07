locals {
  # Single source of truth for the environment name; used in resource names,
  # tags and the OIDC subject prefix.
  environment = "staging"
  name_prefix = "sentravyn-${local.environment}"

  # CIDRs. The app tier and the DB tier are in private subnets; only the app
  # tier's security group is reachable from the load balancer. These are
  # placeholders — a deployment would use the real account VPC CIDRs.
  vpc_cidr_block = "10.0.0.0/16"
  subnets = {
    app_a    = "10.0.1.0/24"
    app_b    = "10.0.2.0/24"
    db_a     = "10.0.101.0/24"
    db_b     = "10.0.102.0/24"
  }

  # RDS engine/DB are placeholders (the PostGIS extension is enabled by
  # reviewed SQL / the Postgres parameter group at provisioning time, ADR-004).
  rds_engine   = "postgres"
  rds_version  = "16"
  db_name      = "sentravyn"

  # Redis (Aurora / ElastiCache) placeholder.
  cache_engine  = "redis"
  cache_version = "7.1"

  # ECS/EC2 skeleton.
  # The workload is the NestJS API + workers (Docker images built elsewhere).
  ecs_family = "sentravyn-api"

  # The CI workflow that is authorised to run this plan/apply via OIDC.
  # This is the workflow *name* (the OIDC subject prefix), not a secret.
  ci_workflow_oidc_subject_prefix = "repo:${var.github_repository}:refs/heads/${var.oidc_branch}"
}
