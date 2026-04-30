# ---------------------------------------------------------------------------
# CloudWatch Dashboards — NH-34
# Three persona views: HR Operations, System Health (Ops), Security/Audit
# ---------------------------------------------------------------------------

locals {
  # Build one error-rate metric entry per Lambda for the health dashboard
  lambda_error_metrics = [
    for name in var.lambda_names : [
      "AWS/Lambda", "Errors",
      "FunctionName", name,
      "Resource", name,
      { "stat" : "Sum", "period" : 300, "label" : "${name} Errors" }
    ]
  ]

  lambda_duration_p50 = [
    for name in var.lambda_names : [
      "AWS/Lambda", "Duration",
      "FunctionName", name,
      "Resource", name,
      { "stat" : "p50", "period" : 300, "label" : "${name} p50" }
    ]
  ]

  lambda_duration_p99 = [
    for name in var.lambda_names : [
      "AWS/Lambda", "Duration",
      "FunctionName", name,
      "Resource", name,
      { "stat" : "p99", "period" : 300, "label" : "${name} p99" }
    ]
  ]

  dynamo_throttle_metrics = [
    for tbl in var.dynamodb_tables : [
      "AWS/DynamoDB", "ThrottledRequests",
      "TableName", tbl,
      { "stat" : "Sum", "period" : 300, "label" : "${tbl} Throttles" }
    ]
  ]
}

# ---------------------------------------------------------------------------
# Dashboard 1: naleko-hr-operations  (HR Manager view)
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "hr_operations" {
  dashboard_name = "naleko-hr-operations"

  dashboard_body = jsonencode({
    widgets = [
      # ── Row 1: headline KPIs ──────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "Onboardings Today (createEmployee invocations)"
          view   = "singleValue"
          region = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "createEmployee",
            { "stat" : "Sum", "period" : 86400, "label" : "Onboardings Today" }]
          ]
          period = 86400
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "Verification Reviews Today (reviewDocumentVerification)"
          view   = "singleValue"
          region = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "reviewDocumentVerification",
            { "stat" : "Sum", "period" : 86400, "label" : "Reviews Today" }]
          ]
          period = 86400
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "Document Uploads Today"
          view   = "singleValue"
          region = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "uploadDocumentToS3",
            { "stat" : "Sum", "period" : 86400, "label" : "Uploads Today" }]
          ]
          period = 86400
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 0
        width  = 6
        height = 6
        properties = {
          title  = "OCR Jobs Today (processDocumentOCR)"
          view   = "singleValue"
          region = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "processDocumentOCR",
            { "stat" : "Sum", "period" : 86400, "label" : "OCR Jobs Today" }]
          ]
          period = 86400
        }
      },
      # ── Row 2: onboarding funnel trend ────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Onboarding Funnel (7d) — Created vs Reviewed"
          view   = "timeSeries"
          region = var.region
          stacked = false
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "createEmployee",
              { "stat" : "Sum", "period" : 86400, "label" : "Employees Created" }],
            ["AWS/Lambda", "Invocations", "FunctionName", "reviewDocumentVerification",
              { "stat" : "Sum", "period" : 86400, "label" : "Reviews Completed" }]
          ]
          period = 86400
          start  = "-P7D"
          end    = "P0D"
        }
      },
      # ── Row 2 right: Average Time to Onboard (custom metric) ─────────────
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Average Time to Onboard (minutes)"
          view   = "timeSeries"
          region = var.region
          metrics = [
            ["Naleko/Onboarding", "TimeToComplete",
              "Environment", var.environment,
              { "stat" : "Average", "period" : 3600, "label" : "Avg (1h)" }],
            ["Naleko/Onboarding", "TimeToComplete",
              "Environment", var.environment,
              { "stat" : "p90", "period" : 3600, "label" : "p90 (1h)" }]
          ]
          period = 3600
        }
      },
      # ── Row 3: createEmployee errors (affects onboarding rate) ───────────
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 24
        height = 5
        properties = {
          title  = "Onboarding Errors (createEmployee)"
          view   = "timeSeries"
          region = var.region
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", "createEmployee",
              { "stat" : "Sum", "period" : 300, "label" : "Errors (5m)" }]
          ]
          period = 300
          annotations = {
            horizontal = [{ value = 1, label = "Any error", color = "#d62728" }]
          }
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Dashboard 2: naleko-system-health  (Ops view)
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "system_health" {
  dashboard_name = "naleko-system-health"

  dashboard_body = jsonencode({
    widgets = [
      # ── Lambda Error Rate ─────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 7
        properties = {
          title   = "Lambda Error Rate — all functions (5m)"
          view    = "timeSeries"
          stacked = false
          region  = var.region
          metrics = local.lambda_error_metrics
          period  = 300
          annotations = {
            horizontal = [{ value = 5, label = "Error threshold", color = "#d62728" }]
          }
        }
      },
      # ── Lambda Duration p50 / p99 ─────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Duration p50 (ms)"
          view    = "timeSeries"
          stacked = false
          region  = var.region
          metrics = local.lambda_duration_p50
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 7
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Duration p99 (ms)"
          view    = "timeSeries"
          stacked = false
          region  = var.region
          metrics = local.lambda_duration_p99
          period  = 300
        }
      },
      # ── API Gateway 4xx / 5xx ─────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 12
        height = 6
        properties = {
          title   = "API GW 5xx Errors"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/ApiGateway", "5XXError", "ApiId", var.employees_api_id,
              { "stat" : "Sum", "period" : 300, "label" : "employees API 5xx" }],
            ["AWS/ApiGateway", "5XXError", "ApiId", var.document_api_id,
              { "stat" : "Sum", "period" : 300, "label" : "document API 5xx" }]
          ]
          period = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 13
        width  = 12
        height = 6
        properties = {
          title   = "API GW 4xx Errors"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/ApiGateway", "4XXError", "ApiId", var.employees_api_id,
              { "stat" : "Sum", "period" : 300, "label" : "employees API 4xx" }],
            ["AWS/ApiGateway", "4XXError", "ApiId", var.document_api_id,
              { "stat" : "Sum", "period" : 300, "label" : "document API 4xx" }]
          ]
          period = 300
        }
      },
      # ── DynamoDB Throttles ────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 12
        height = 6
        properties = {
          title   = "DynamoDB ThrottledRequests"
          view    = "timeSeries"
          region  = var.region
          metrics = local.dynamo_throttle_metrics
          period  = 300
          annotations = {
            horizontal = [{ value = 1, label = "Any throttle", color = "#ff7f0e" }]
          }
        }
      },
      # ── S3 Upload Errors ──────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 19
        width  = 12
        height = 6
        properties = {
          title   = "S3 5xx Errors (document-ocr-verification-uploads)"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/S3", "5xxErrors", "BucketName", var.s3_bucket,
              "FilterId", "EntireBucket",
              { "stat" : "Sum", "period" : 300, "label" : "S3 5xx" }]
          ]
          period = 300
        }
      },
      # ── Lambda Concurrency ────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 25
        width  = 24
        height = 5
        properties = {
          title   = "Lambda Concurrent Executions (account-level)"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions",
              { "stat" : "Maximum", "period" : 60, "label" : "Max concurrency (1m)" }]
          ]
          period = 60
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Dashboard 3: naleko-security  (CISO / Audit view)
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_dashboard" "security" {
  dashboard_name = "naleko-security"

  dashboard_body = jsonencode({
    widgets = [
      # ── 401/403 Rates ─────────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Auth Errors (4xx) — employees API"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/ApiGateway", "4XXError", "ApiId", var.employees_api_id,
              { "stat" : "Sum", "period" : 300, "label" : "4xx (5m)" }]
          ]
          period = 300
          annotations = {
            horizontal = [{ value = 10, label = "Alert threshold", color = "#d62728" }]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Auth Errors (4xx) — document API"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/ApiGateway", "4XXError", "ApiId", var.document_api_id,
              { "stat" : "Sum", "period" : 300, "label" : "4xx (5m)" }]
          ]
          period = 300
          annotations = {
            horizontal = [{ value = 10, label = "Alert threshold", color = "#d62728" }]
          }
        }
      },
      # ── Presigned URL generations (document access events) ────────────────
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Presigned URL Generations (document access audit)"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "getDocumentPresignedUrl",
              { "stat" : "Sum", "period" : 3600, "label" : "URL generations (1h)" }]
          ]
          period = 3600
        }
      },
      # ── reviewDocumentVerification audit trail ────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "HR Review Activity (reviewDocumentVerification)"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "reviewDocumentVerification",
              { "stat" : "Sum", "period" : 3600, "label" : "Reviews (1h)" }],
            ["AWS/Lambda", "Errors", "FunctionName", "reviewDocumentVerification",
              { "stat" : "Sum", "period" : 3600, "label" : "Review Errors (1h)" }]
          ]
          period = 3600
        }
      },
      # ── Lambda invocations per function (audit breadth) ───────────────────
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 24
        height = 7
        properties = {
          title   = "All Lambda Invocations per Hour (activity audit)"
          view    = "timeSeries"
          stacked = false
          region  = var.region
          metrics = [
            for name in var.lambda_names : [
              "AWS/Lambda", "Invocations",
              "FunctionName", name,
              { "stat" : "Sum", "period" : 3600, "label" : name }
            ]
          ]
          period = 3600
        }
      },
      # ── Custom metric: ID decryptions (NH-20 placeholder) ─────────────────
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 12
        height = 6
        properties = {
          title   = "ID Number Decryption Events (Naleko/Security)"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["Naleko/Security", "IdNumberDecrypted",
              "Environment", var.environment,
              { "stat" : "Sum", "period" : 3600, "label" : "Decryptions (1h)" }]
          ]
          period = 3600
          annotations = {
            horizontal = [{ value = 50, label = "Anomaly threshold", color = "#ff7f0e" }]
          }
        }
      },
      # ── processDocumentOCR — external API calls audit ─────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 19
        width  = 12
        height = 6
        properties = {
          title   = "OCR Processing (Textract/Bedrock calls)"
          view    = "timeSeries"
          region  = var.region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "processDocumentOCR",
              { "stat" : "Sum", "period" : 3600, "label" : "OCR Jobs (1h)" }],
            ["AWS/Lambda", "Errors", "FunctionName", "processDocumentOCR",
              { "stat" : "Sum", "period" : 3600, "label" : "OCR Errors (1h)" }]
          ]
          period = 3600
        }
      }
    ]
  })
}
