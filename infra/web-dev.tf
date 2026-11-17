# ---------------------------------------------------------------------------
# OPS-01: the new app (pepla-web) and the public site on one address in pepla-dev.
#
# A private S3 bucket in af-south-1 holds the built files. CloudFront serves them
# over HTTPS on its own https://<id>.cloudfront.net address (output
# web_dev_address) and reads the bucket through Origin Access Control, so the
# bucket itself is never public. No domain or certificate yet.
#
# Dev only: every resource here has count = 0 in prod. Prod hosting is OPS-04 and
# SITE-06. Names are naleko-people-..., never pepla-... (nothing public may say
# "pepla").
#
# What it serves (pepla-web builds static files; angular.json outputMode "static"):
#   /                    index.html, the prerendered landing page
#   /<route>             <route>/index.html when the build prerendered that route
#                        (the rewrite function adds "/index.html")
#   anything else        index.csr.html, the app shell, so /hr, /hr/employees/<id>,
#                        /sign-in and unknown paths open in the browser. S3 answers
#                        403 for a file that is not there (the bucket policy gives
#                        CloudFront no list right), and CloudFront turns that into
#                        the app shell with status 200.
#
# The files are copied in by the "Naleko People dev" steps of the "Deploy to pepla-dev" job in
# .github/workflows/deploy-lambdas.yml (scripts/ci/deploy-web-dev.sh), not by
# Terraform: Terraform never manages the files, only the place they live.
# ---------------------------------------------------------------------------

locals {
  web_dev_enabled = var.environment != "prod"
  web_dev_name    = "naleko-people-dev-web"
}

resource "aws_s3_bucket" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  bucket = "${local.web_dev_name}-${var.aws_account_id}"

  tags = {
    Name = local.web_dev_name
    # Public build files only; the provider's default says PII.
    DataClassification = "Public"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  bucket                  = aws_s3_bucket.web_dev[0].id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  bucket = aws_s3_bucket.web_dev[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Only public build files live here, so S3's own keys (SSE-S3) are enough, and CloudFront
# reads them without any KMS grant.
resource "aws_s3_bucket_server_side_encryption_configuration" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  bucket = aws_s3_bucket.web_dev[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  name                              = "${local.web_dev_name}-oac"
  description                       = "${local.web_dev_name}: CloudFront signs its reads of the bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  name    = "${local.web_dev_name}-headers"
  comment = "${local.web_dev_name}: safe headers, and keep search engines out of the dev address"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }
}

# Runs on every request before the cache. Angular writes a prerendered page for
# /platform as platform/index.html, and S3 does not look for index files, so
# a path with no file ending gets "/index.html" added. A path that has no such
# file (/hr, /sign-in, an unknown address) falls through to the app shell below.
resource "aws_cloudfront_function" "web_dev_rewrite" {
  count = local.web_dev_enabled ? 1 : 0

  name    = "${local.web_dev_name}-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "${local.web_dev_name}: /route becomes /route/index.html"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.charAt(uri.length - 1) === '/') {
        request.uri = uri + 'index.html';
      } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        request.uri = uri + '/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_distribution" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = local.web_dev_name
  default_root_object = "index.html"
  # Africa's edge locations start at class 200.
  price_class = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.web_dev[0].bucket_regional_domain_name
    origin_id                = "web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web_dev[0].id
  }

  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS managed "CachingOptimized": honours the files' own Cache-Control
    # (hashed files a year, index files no-cache) and compresses.
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web_dev[0].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.web_dev_rewrite[0].arn
    }
  }

  # A file that is not in the bucket: open the app shell, which shows the right
  # page in the browser. Not cached, so a new prerendered page shows at once.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.csr.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.csr.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = local.web_dev_name
    # Public build files only; the provider's default says PII.
    DataClassification = "Public"
  }
}

# CloudFront (and only this distribution) may read the files; nothing else may, and
# plain HTTP is refused.
resource "aws_s3_bucket_policy" "web_dev" {
  count = local.web_dev_enabled ? 1 : 0

  bucket = aws_s3_bucket.web_dev[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ReadFromThisDistributionOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web_dev[0].arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web_dev[0].arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.web_dev[0].arn, "${aws_s3_bucket.web_dev[0].arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.web_dev]
}

output "web_dev_address" {
  description = "OPS-01: where the new app and the public site are on pepla-dev. Empty in prod."
  value       = local.web_dev_enabled ? "https://${aws_cloudfront_distribution.web_dev[0].domain_name}" : null
}

output "web_dev_bucket" {
  description = "OPS-01: the private bucket the web app is copied into. Empty in prod."
  value       = local.web_dev_enabled ? aws_s3_bucket.web_dev[0].bucket : null
}
