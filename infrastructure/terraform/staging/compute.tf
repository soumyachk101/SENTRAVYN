# Compute skeleton (ARCHITECTURE.md: NestJS API + workers, Docker images).
#
# A reviewed but deliberately minimal ECS Fargate skeleton:
#  - an ECS cluster (the "ECS or EC2 skeleton" the plan calls for);
#  - a task definition (API container placeholders; the image is built
#    elsewhere in the pipeline and referenced by a variable);
#  - an ECS service that runs that task, in the app subnets behind the app
#    security group.
#
# Secrets (DB/Redis endpoints, AUTH_JWT_SECRET, etc.) are NOT modelled here:
# they are injected from a secrets manager at deploy time and must never be
# written into the task definition in-repo (SECURITY.md 4).
#
# OTEL/Sentry env placeholders from .env.example are passed through to the
# container env only when set in the deploy environment.

resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  container_insights_log_options = null

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = local.ecs_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.ecs_family
      image     = var.container_image
      essential = true
      portMappings = [
        {
          containerPort = 4000
          protocol      = "tcp"
        }
      ]
      environment = []
      # Observability wiring (docs/ROADMAP.md; OTEL/Sentry placeholders).
      # These are only meaningful when set at deploy time; empty here.
      #   OTEL_EXPORTER_OTLP_ENDPOINT
      #   SENTRY_DSN
      secrets = []
    }
  ])

  tags = {
    Name = local.name_prefix
  }
}

resource "aws_ecs_service" "api" {
  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.service_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = values(aws_subnet.app)
    security_groups  = [aws_security_group.app.id]
    awsvpc_multi_eni = true
  }

  # No load balancer modelled in the skeleton; wire the ALB target group in a
  # later phase. The service still needs a deployment circuit breaker off by
  # default so a bad task definition does not strand the pipeline.
  deployment_circuit_breaker {
    enable   = false
    rollback = false
  }

  tags = {
    Name = "${local.name_prefix}-api-service"
  }
}

# ---------------------------------------------------------------- IAM roles
# Minimal task/execution roles. The execution role can only pull from the
# (placeholder) ECR repository; the task role carries no wildcard grants —
# a real deploy would add scoped S3 / secrets-manager permissions (least
# privilege, SECURITY.md 4).

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_execution_ecr" {
  name   = "${local.name_prefix}-ecs-task-execution-ecr"
  role   = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ]
      # Placeholder ECR prefix; a deploy scopes this to the exact repository.
      Resources = ["*"]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

# -------------------------------------------------------------------- outputs

output "ecs_cluster_arn" {
  description = "ECS cluster ARN (placeholder; NOT a deployed value)."
  value       = aws_ecs_cluster.this.arn
}
