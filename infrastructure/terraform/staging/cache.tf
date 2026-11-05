# Redis cache (BullMQ + throttler storage; ARCHITECTURE.md).
#
# AWS Redis is ElastiCache (Redis OSS) — "Aurora Redis" is not a thing,
# Aurora is the Postgres/MySQL engine. This skeleton provisions an
# ElastiCache Redis 7.1 replica in the private app subnets, reachable only
# from the application security group. The application reads the endpoint
# from the REDIS_URL secret injected at deploy time.

resource "aws_elasticache_subnet_group" "cache" {
  name       = "${local.name_prefix}-cache"
  subnet_ids = values(aws_subnet.app)

  tags = {
    Name = "${local.name_prefix}-cache-subnets"
  }
}

resource "aws_elasticache_replication_group" "cache" {
  replication_group_id       = local.name_prefix
  description                = "SENTRAVYN ${local.environment} BullMQ + throttler cache"
  engine                     = local.cache_engine
  engine_version             = local.cache_version
  node_type                  = "cache.t4g.micro"
  num_cache_clusters         = 1
  subnet_group_name          = aws_elasticache_subnet_group.cache.name
  apply_immediately          = false
  automatic_failover_enabled = false
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false

  # No public access; in-VPC only (gated by the application security group).
  security_group_ids = [aws_security_group.app.id]

  tags = {
    Name = local.name_prefix
  }
}

output "cache_endpoint" {
  description = "ElastiCache read endpoint (placeholder; NOT a deployed value)."
  value       = aws_elasticache_replication_group.cache.primary_endpoint_address
}
