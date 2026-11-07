# Staging infrastructure for SENTRAVYN (AWS).
#
# This is a REVIEWED SKELETON: it describes the resources but NOTHING has
# been applied. It is validated locally with `terraform init -backend=false`
# and `terraform validate` only — there is no AWS account, no credentials and
# no cloud access in the dev/CI environment, so no real resource is created
# by this module. See README.md.

terraform {
  required_version = ">= 1.6, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Default tags applied to every resource that supports tagging.
  default_tags {
    tags = {
      Project     = "sentravyn"
      Environment = "staging"
      ManagedBy   = "terraform"
      # ADR: no secrets, no precise-location data, no personal data in tags.
    }
  }
}
