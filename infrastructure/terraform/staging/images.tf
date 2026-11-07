# Container / service placeholders (no secrets).
#
# The API and worker container images are built by the Docker pipeline and
# referenced here by their registry URI. The placeholder default is an
# untagged image that would not boot — it is deliberately inert so this
# module validates without a real build. A deploy fills these from the
# pipeline's image outputs.

variable "container_image" {
  description = "Container image URI for the API service (built by the Docker pipeline; placeholder)."
  type        = string
  default     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/sentravyn/api:staging"
}

variable "service_desired_count" {
  description = "Desired running task count for the API service in staging."
  type        = number
  default     = 1
}
