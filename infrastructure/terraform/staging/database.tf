# Managed RDS PostgreSQL with PostGIS enabled (ADR-004; ARCHITECTURE.md).
#
# RDS PostgreSQL carries PostGIS via two steps, both modelled here:
#   1. A DB parameter group that sets `rds_enable_postgis = 1` — the switch RDS
#      requires before the spatial extension can be created.
#   2. The `CREATE EXTENSION postgis;` DDL is run against the DB by the
#      application's reviewed migration path (infrastructure/docker/initdb/
#      enable-postgis.sql is the local analogue; Terraform has no first-class
#      "extension" resource, so the DDL is an operational step, not a plan).
#
# Multi-AZ and a 7-day retention window give the Phase 9 "backup restore"
# gate a resourcable baseline (SECURITY.md 7: "Backups and tested
# restoration").
#
# NOTE: nothing in this module is deployed. It is reviewed code that validates
# locally; see README.md (Gate F: deployment status = NOT RUN).

resource "aws_db_subnet_group" "db" {
  name       = "${local.name_prefix}-db"
  subnet_ids = values(aws_subnet.db)

  tags = {
    Name = "${local.name_prefix}-db-subnets"
  }
}

# Enable PostGIS on the RDS PostgreSQL engine (ADR-004).
resource "aws_db_parameter_group" "postgis" {
  name   = "${local.name_prefix}-postgis"
  family = "postgres16"

  parameter {
    name  = "rds_enable_postgis"
    value = "1"
  }

  tags = {
    Name = "${local.name_prefix}-postgis"
  }
}

resource "aws_db_instance" "postgres" {
  identifier            = "${local.name_prefix}-postgres"
  engine                = local.rds_engine
  engine_version        = local.rds_version
  db_name               = local.db_name
  instance_class        = "db.m6g.large"
  db_subnet_group_name  = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name  = aws_db_parameter_group.postgis.name

  allocated_storage     = 20
  max_allocated_storage = 80
  storage_encrypted     = true

  # Backup / point-in-time recovery (SECURITY.md 7). `backup_window` is the
  # valid aws_db_instance argument for the daily automated-backup window
  # (HH:MM-HH:MM UTC). The optional `preferred_maintenance_window` is left to
  # the RDS default in this skeleton.
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  multi_az                = true

  auto_minor_version_upgrade = true
  deletion_protection        = false # staging: allow teardown; flip in production
  skip_final_snapshot        = true
  publicly_accessible        = false

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

# Explicit record of the PostGIS intent (ADR-004): the parameter group enables
# the spatial engine switch; the extension itself is created by the reviewed
# migration DDL, which Terraform cannot express as a resource.
output "postgis_intended" {
  description = "PostGIS enabled via the rds_enable_postgis parameter group + reviewed CREATE EXTENSION DDL (ADR-004)."
  value = {
    engine          = local.rds_engine
    engine_version  = local.rds_version
    parameter_group = aws_db_parameter_group.postgis.name
    postgis         = true
  }
}

output "db_endpoint" {
  description = "RDS endpoint (placeholder; NOT a deployed value)."
  value       = aws_db_instance.postgres.endpoint
}
