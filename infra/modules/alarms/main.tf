# ---------------------------------------------------------------------------
# CloudWatch Alarms + SNS — NH-35
# SNS topic: naleko-ops-alerts
# 7 metric alarms + 1 composite critical alarm
# ---------------------------------------------------------------------------

# ── SNS Topic ────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "naleko_ops" {
  name = "naleko-ops-alerts"

  tags = {
    Environment = var.environment
    Project     = "naleko"
  }
}

resource "aws_sns_topic_subscription" "ops_email" {
  topic_arn = aws_sns_topic.naleko_ops.arn
  protocol  = "email"
  endpoint  = var.ops_email
}

# ── Alarm 1: Lambda Error Rate (sum all functions) ────────────────────────────

resource "aws_cloudwatch_metric_alarm" "lambda_error_rate_high" {
  alarm_name          = "naleko-lambda-error-rate-high"
  alarm_description   = "Total Lambda errors across all Naleko functions exceeded 5 in a 5-minute window. Investigate CloudWatch Logs and X-Ray traces."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  # Metric math: sum all individual Lambda error counts into one M_TOTAL
  metric_query {
    id          = "e1"
    expression  = join("+", [for i, name in var.lambda_names : "m${i + 1}"])
    label       = "Total Lambda Errors"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = var.lambda_names
    content {
      id = "m${metric_query.key + 1}"
      metric {
        namespace   = "AWS/Lambda"
        metric_name = "Errors"
        period      = 300
        stat        = "Sum"
        dimensions = {
          FunctionName = metric_query.value
          Resource     = metric_query.value
        }
      }
    }
  }

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# ── Alarm 2: API Gateway 5xx (sum both APIs) ─────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "api_5xx_high" {
  alarm_name          = "naleko-api-5xx-high"
  alarm_description   = "API Gateway 5xx errors exceeded 10 in 1 minute. Check Lambda logs for unhandled exceptions."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 10
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  metric_query {
    id          = "e1"
    expression  = "m1 + m2"
    label       = "Total 5xx Errors"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "5XXError"
      period      = 60
      stat        = "Sum"
      dimensions  = { ApiId = var.employees_api_id }
    }
  }

  metric_query {
    id = "m2"
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "5XXError"
      period      = 60
      stat        = "Sum"
      dimensions  = { ApiId = var.document_api_id }
    }
  }

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# ── Alarm 3: API Gateway 4xx spike (sum both APIs) ────────────────────────────

resource "aws_cloudwatch_metric_alarm" "api_4xx_spike" {
  alarm_name          = "naleko-api-4xx-spike"
  alarm_description   = "API Gateway 4xx errors exceeded 50 in 1 minute. Possible auth/credential attack or client bug."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 50
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  metric_query {
    id          = "e1"
    expression  = "m1 + m2"
    label       = "Total 4xx Errors"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "4XXError"
      period      = 60
      stat        = "Sum"
      dimensions  = { ApiId = var.employees_api_id }
    }
  }

  metric_query {
    id = "m2"
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "4XXError"
      period      = 60
      stat        = "Sum"
      dimensions  = { ApiId = var.document_api_id }
    }
  }

  tags = {
    Environment = var.environment
    Severity    = "medium"
  }
}

# ── Alarm 4: DynamoDB throttles (any table) ───────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttles" {
  alarm_name          = "naleko-dynamodb-throttles"
  alarm_description   = "DynamoDB ThrottledRequests detected on one or more Naleko tables. PAY_PER_REQUEST should not throttle — investigate table-level burst limits."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  metric_query {
    id          = "e1"
    expression  = join("+", [for i, tbl in var.dynamodb_tables : "m${i + 1}"])
    label       = "Total DynamoDB Throttles"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = var.dynamodb_tables
    content {
      id = "m${metric_query.key + 1}"
      metric {
        namespace   = "AWS/DynamoDB"
        metric_name = "ThrottledRequests"
        period      = 60
        stat        = "Sum"
        dimensions  = { TableName = metric_query.value }
      }
    }
  }

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# ── Alarm 5: Lambda Duration p99 (max across all functions) ──────────────────

resource "aws_cloudwatch_metric_alarm" "lambda_duration_p99" {
  alarm_name          = "naleko-lambda-duration-p99"
  alarm_description   = "p99 Lambda duration exceeded 10,000 ms. Bottleneck detected — check X-Ray traces for the slow function."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 10000
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  # MAX of p99 across all functions
  metric_query {
    id          = "e1"
    expression  = "MAX([${join(",", [for i, name in var.lambda_names : "m${i + 1}"])}])"
    label       = "Max p99 Duration (ms)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = var.lambda_names
    content {
      id = "m${metric_query.key + 1}"
      metric {
        namespace   = "AWS/Lambda"
        metric_name = "Duration"
        period      = 300
        stat        = "p99"
        dimensions = {
          FunctionName = metric_query.value
          Resource     = metric_query.value
        }
      }
    }
  }

  tags = {
    Environment = var.environment
    Severity    = "medium"
  }
}

# ── Alarm 6: Audit events stopped (custom metric — starts once NH-27 publishes) ──

resource "aws_cloudwatch_metric_alarm" "audit_events_stopped" {
  alarm_name          = "naleko-audit-events-stopped"
  alarm_description   = "No audit events recorded in the last 60 minutes during business hours. Possible audit pipeline failure."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  threshold           = 1
  # IMPORTANT: treat missing data as breaching during business hours so silence is visible
  treat_missing_data = "breaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  namespace   = "Naleko/Onboarding"
  metric_name = "AuditEventsPerHour"
  statistic   = "Sum"
  period      = 3600
  dimensions = {
    Environment = var.environment
  }

  tags = {
    Environment = var.environment
    Severity    = "medium"
  }
}

# ── Alarm 7: KMS Decrypt spike (future-ready — stays INSUFFICIENT_DATA until KMS key is added) ──

resource "aws_cloudwatch_metric_alarm" "kms_decrypt_spike" {
  alarm_name          = "naleko-kms-decrypt-spike"
  alarm_description   = "KMS Decrypt calls exceeded 100 in 5 minutes. Possible anomalous data access — review CloudTrail."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 100
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  namespace   = "AWS/KMS"
  metric_name = "DecryptCount"
  statistic   = "Sum"
  period      = 300

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# ── Composite Critical Alarm ──────────────────────────────────────────────────
# Fires if Lambda errors OR API 5xx are in ALARM — PagerDuty-style critical page

resource "aws_cloudwatch_composite_alarm" "naleko_critical" {
  alarm_name        = "naleko-production-critical"
  alarm_description = "CRITICAL: One or more core Naleko production alarms are firing. Immediate action required."

  alarm_rule = "ALARM(\"${aws_cloudwatch_metric_alarm.lambda_error_rate_high.alarm_name}\") OR ALARM(\"${aws_cloudwatch_metric_alarm.api_5xx_high.alarm_name}\")"

  alarm_actions = [aws_sns_topic.naleko_ops.arn]
  ok_actions    = [aws_sns_topic.naleko_ops.arn]

  tags = {
    Environment = var.environment
    Severity    = "critical"
  }
}
