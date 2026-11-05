# Staging infrastructure variables.
#
# No secrets live here or in this repo. The AWS credentials for the deploy are
# never committed: in CI they come from the OIDC assume-role (see oidc.tf),
# and locally they come from the environment (AWS_PROFILE / ~/.aws). Nothing
# in this module runs `terraform apply` in CI — it is validate-only
# (README.md, Gate F: deployment status NOT RUN).

variable "aws_region" {
  description = "AWS region for the staging stack (placeholder)."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Logical environment name; used in resource names and tags."
  type        = string
  default     = "staging"
}
