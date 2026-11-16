# ---------------------------------------------------------------------------
# TEN-07 (NH-199): configRegionCheck's own least-privilege role.
# Replaces the shared doc-verification-lambda-role, which had no config:*
# permission, so every evaluation failed (BE-13). Lives in this module so it
# exists only where the Lambda exists (prod). Not exposed as a module output.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "config_region_check" {
  name        = "naleko-configRegionCheck-role"
  description = "Execution role for configRegionCheck Lambda"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = {
    Environment = var.environment
    Project     = "naleko"
  }
}

resource "aws_iam_role_policy" "config_region_check" {
  name = "naleko-configRegionCheck-policy"
  role = aws_iam_role.config_region_check.name

  # config:PutEvaluations does not support resource-level permissions, so it
  # needs Resource "*". The X-Ray write actions are the same. Nothing else here
  # uses "*".
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ConfigEvaluations"
        Effect   = "Allow"
        Action   = ["config:PutEvaluations"]
        Resource = "*"
      },
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        # The group itself is managed in infra/cloudwatch.tf.
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/configRegionCheck:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      }
    ]
  })
}
