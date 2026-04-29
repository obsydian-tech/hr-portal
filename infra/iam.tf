# ---------------------------------------------------------------------------
# IAM Role — NH-11 Terraform import
# ---------------------------------------------------------------------------

resource "aws_iam_role" "lambda_execution" {
  name        = "doc-verification-lambda-role"
  description = "Allows Lambda functions to call AWS services on your behalf."
  path        = "/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/AmazonBedrockFullAccess",
    "arn:aws:iam::aws:policy/AmazonCognitoPowerUser",
    "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
    "arn:aws:iam::aws:policy/AmazonS3FullAccess",
    "arn:aws:iam::aws:policy/AmazonTextractFullAccess",
    "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
  ]

  max_session_duration = 3600
}
