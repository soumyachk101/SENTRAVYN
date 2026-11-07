# ACM certificate (HTTPS placeholder; ARCHITECTURE.md "TLS for all external
# and internal sensitive traffic where feasible", SECURITY.md 4).
#
# This is a placeholder that records the intended domain. Do NOT fabricate a
# domain or claim the certificate is issued: the ACM certificate resource
# requires a real, owned domain and a DNS-01 verification. Until the owner
# purchases/points a domain (docs/BRAND-NAMING.md, docs/SEO-AEO-GEO.md),
# this resource is intentionally a commented-out placeholder so the module
# still validates on its own without an external dependency.
#
# Uncomment and fill `domain` only when a real domain is available:
#
# resource "aws_acm_certificate" "this" {
#   domain          = var.acm_domain
#   subject_alternative_names = []
#   validation_method = "DNS"
#
#   lifecycle {
#     # Keep the cert usable across replacements.
#     create_before_destroy = true
#   }
# }
#
# Outputs of the pending cert:
#   aws_acm_certificate.this.arn        -> ALB / API Gateway / CloudFront
#   aws_acm_certificate.this.domain_validation_tokens

variable "acm_domain" {
  description = "Domain for the ACM certificate. Leave empty until a real domain exists; the cert resource stays commented out (see README)."
  type        = string
  default     = ""
}
