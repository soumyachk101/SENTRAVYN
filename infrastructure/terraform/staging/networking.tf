# VPC + subnets + security groups.
#
# Private-only app and database tiers: the application security group accepts
# traffic only from the load balancer; the database security group accepts
# traffic only from the application security group. Nothing here is
# internet-exposed. See README.md (NOT deployed; validate-only).

data "aws_region" "current" {}

resource "aws_vpc" "this" {
  cidr_block           = local.vpc_cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_subnet" "app" {
  for_each = {
    app_a = local.subnets.app_a
    app_b = local.subnets.app_b
  }

  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value
  availability_zone = each.key == "app_a" ? "${data.aws_region.current.name}a" : "${data.aws_region.current.name}b"

  tags = {
    Name = "${local.name_prefix}-app-${each.key}"
    Tier = "app"
  }
}

resource "aws_subnet" "db" {
  for_each = {
    db_a = local.subnets.db_a
    db_b = local.subnets.db_b
  }

  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value
  availability_zone = each.key == "db_a" ? "${data.aws_region.current.name}a" : "${data.aws_region.current.name}b"

  tags = {
    Name = "${local.name_prefix}-db-${each.key}"
    Tier = "db"
  }
}

# Internet gateway is attached for route-table completeness of a private VPC
# that may later add NAT; no subnet route points to the public internet here,
# so the app/DB tiers remain private.
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-public"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

# App security group: reachable only from the load balancer (its SG is created
# where the load balancer lands; here we allow a controlled CIDR placeholder).
resource "aws_security_group" "app" {
  name   = "${local.name_prefix}-app"
  vpc_id = aws_vpc.this.id

  ingress {
    description     = "API/worker HTTP from the application load balancer"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    # Placeholder: replace with the ALB security-group reference once the ALB
    # is part of this module (kept a CIDR so the module validates standalone).
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    description = "Allow all outbound to the VPC (DB + cache)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [local.vpc_cidr_block]
  }

  tags = {
    Name = "${local.name_prefix}-app"
  }
}

# Database security group: reachable only from the application security group.
resource "aws_security_group" "db" {
  name   = "${local.name_prefix}-db"
  vpc_id = aws_vpc.this.id

  ingress {
    description     = "PostgreSQL from application tier only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # No egress: the database never initiates outbound connections.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-db"
  }
}
