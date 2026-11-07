# S3 object storage (archived assets / exports / logs; ARCHITECTURE.md S3).
#
# The stack uses S3 for object storage (e.g. provider-derived artifacts,
# exports, cold logs). This skeleton provisions a versioned, encrypted,
# access-limited bucket. No public access is enabled; the app reaches it via
# an IAM role at deploy time (not modelled here — out of scope for a skeleton).

resource "aws_s3_bucket" "assets" {
  bucket        = "${local.name_prefix}-assets"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

output "assets_bucket" {
  description = "S3 object-storage bucket (placeholder; NOT a deployed value)."
  value       = aws_s3_bucket.assets.bucket
}
