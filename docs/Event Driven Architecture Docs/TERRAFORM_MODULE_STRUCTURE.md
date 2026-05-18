# Terraform Module Structure - Reusable IaC

> **Purpose**: Define reusable Terraform modules for rapid infrastructure deployment
> **Audience**: DevOps, Developers
> **Status**: v1.0 - Implementation Ready

---

## Executive Summary

This document defines the Terraform module structure for the Talent Flow platform, designed for:
- **Reusability**: Modules shared across environments (dev, staging, prod)
- **AI-Friendly**: Clear structure for AI code generation
- **Integration**: Compatible with existing Terraform modules in the project
- **Incremental**: Deploy Stage 1-3 first, then expand

---

## Repository Structure

```
terraform/
├── modules/                          # Reusable modules
│   ├── lambda-function/              # Single Lambda function
│   ├── eventbridge-bus/              # EventBridge bus + rules
│   ├── dynamodb-table/               # DynamoDB table + GSI
│   ├── sqs-queue/                    # SQS queue
│   ├── sns-topic/                    # SNS topic
│   ├── step-functions/               # Step Functions state machine
│   └── api-gateway/                  # API Gateway REST API
├── environments/                     # Environment-specific configs
│   ├── dev/                          # Development environment
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── terraform.tfvars
│   ├── staging/                      # Staging environment
│   └── prod/                         # Production environment
├── global/                           # Shared resources (IAM roles, etc.)
│   ├── iam-roles.tf
│   └── outputs.tf
└── README.md
```

---

## Module 1: Lambda Function

### Purpose
Reusable module for deploying Lambda functions with consistent configuration.

### Module Structure
```
modules/lambda-function/
├── main.tf                    # Lambda resource definitions
├── variables.tf               # Input variables
├── outputs.tf                 # Exported values
├── iam.tf                     # IAM role + policies
└── README.md                  # Usage documentation
```

### main.tf
```hcl
# modules/lambda-function/main.tf

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = aws_iam_role.lambda_exec.arn
  handler          = var.handler
  runtime          = var.runtime
  architectures    = var.architectures
  memory_size      = var.memory_size
  timeout          = var.timeout
  filename         = var.source_code_zip
  source_code_hash = filebase64sha256(var.source_code_zip)

  environment {
    variables = var.environment_variables
  }

  dynamic "vpc_config" {
    for_each = var.vpc_config != null ? [var.vpc_config] : []
    content {
      subnet_ids         = vpc_config.value.subnet_ids
      security_group_ids = vpc_config.value.security_group_ids
    }
  }

  tags = merge(
    {
      Name        = var.function_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags
  )
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days

  tags = var.tags
}

# EventBridge trigger (optional)
resource "aws_cloudwatch_event_rule" "trigger" {
  count = var.eventbridge_rule != null ? 1 : 0

  name                = "${var.function_name}-trigger"
  description         = "EventBridge rule for ${var.function_name}"
  event_bus_name      = var.eventbridge_rule.event_bus_name
  event_pattern       = var.eventbridge_rule.event_pattern
  schedule_expression = var.eventbridge_rule.schedule_expression

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "lambda" {
  count = var.eventbridge_rule != null ? 1 : 0

  rule           = aws_cloudwatch_event_rule.trigger[0].name
  event_bus_name = var.eventbridge_rule.event_bus_name
  arn            = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "eventbridge" {
  count = var.eventbridge_rule != null ? 1 : 0

  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.trigger[0].arn
}

# SQS trigger (optional)
resource "aws_lambda_event_source_mapping" "sqs" {
  count = var.sqs_trigger != null ? 1 : 0

  event_source_arn = var.sqs_trigger.queue_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = var.sqs_trigger.batch_size
  enabled          = true
}

# Dead Letter Queue (optional)
resource "aws_sqs_queue" "dlq" {
  count = var.enable_dlq ? 1 : 0

  name                       = "${var.function_name}-dlq"
  message_retention_seconds  = 1209600  # 14 days
  visibility_timeout_seconds = var.timeout * 6

  tags = var.tags
}

resource "aws_lambda_function_event_invoke_config" "dlq" {
  count = var.enable_dlq ? 1 : 0

  function_name = aws_lambda_function.this.function_name

  destination_config {
    on_failure {
      destination = aws_sqs_queue.dlq[0].arn
    }
  }

  maximum_retry_attempts = var.max_retry_attempts
  maximum_event_age_in_seconds = var.max_event_age_seconds
}
```

### variables.tf
```hcl
# modules/lambda-function/variables.tf

variable "function_name" {
  description = "Name of the Lambda function"
  type        = string
}

variable "handler" {
  description = "Lambda function handler"
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs20.x"
}

variable "architectures" {
  description = "Lambda architectures"
  type        = list(string)
  default     = ["arm64"]
}

variable "memory_size" {
  description = "Lambda memory size (MB)"
  type        = number
  default     = 512
}

variable "timeout" {
  description = "Lambda timeout (seconds)"
  type        = number
  default     = 10
}

variable "source_code_zip" {
  description = "Path to Lambda deployment package (.zip)"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for Lambda"
  type        = map(string)
  default     = {}
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "CloudWatch log retention (days)"
  type        = number
  default     = 7
}

variable "vpc_config" {
  description = "VPC configuration for Lambda"
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}

variable "eventbridge_rule" {
  description = "EventBridge rule configuration"
  type = object({
    event_bus_name      = string
    event_pattern       = string
    schedule_expression = optional(string)
  })
  default = null
}

variable "sqs_trigger" {
  description = "SQS trigger configuration"
  type = object({
    queue_arn  = string
    batch_size = number
  })
  default = null
}

variable "enable_dlq" {
  description = "Enable Dead Letter Queue"
  type        = bool
  default     = true
}

variable "max_retry_attempts" {
  description = "Maximum retry attempts for async invocations"
  type        = number
  default     = 2
}

variable "max_event_age_seconds" {
  description = "Maximum event age for async invocations (seconds)"
  type        = number
  default     = 21600  # 6 hours
}

variable "iam_policy_statements" {
  description = "Additional IAM policy statements for Lambda execution role"
  type = list(object({
    effect    = string
    actions   = list(string)
    resources = list(string)
  }))
  default = []
}
```

### iam.tf
```hcl
# modules/lambda-function/iam.tf

resource "aws_iam_role" "lambda_exec" {
  name = "${var.function_name}-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

# Basic execution policy (CloudWatch Logs)
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# VPC execution policy (if VPC configured)
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  count = var.vpc_config != null ? 1 : 0

  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Custom IAM policy (for DynamoDB, EventBridge, etc.)
resource "aws_iam_role_policy" "lambda_custom" {
  count = length(var.iam_policy_statements) > 0 ? 1 : 0

  name = "${var.function_name}-custom-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = var.iam_policy_statements
  })
}

# DLQ policy (if enabled)
resource "aws_iam_role_policy" "dlq" {
  count = var.enable_dlq ? 1 : 0

  name = "${var.function_name}-dlq-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:SendMessage"
      ]
      Resource = aws_sqs_queue.dlq[0].arn
    }]
  })
}
```

### outputs.tf
```hcl
# modules/lambda-function/outputs.tf

output "function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.this.arn
}

output "function_invoke_arn" {
  description = "Invoke ARN of the Lambda function"
  value       = aws_lambda_function.this.invoke_arn
}

output "role_arn" {
  description = "ARN of the Lambda execution role"
  value       = aws_iam_role.lambda_exec.arn
}

output "log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.lambda_logs.name
}

output "dlq_arn" {
  description = "ARN of the Dead Letter Queue (if enabled)"
  value       = var.enable_dlq ? aws_sqs_queue.dlq[0].arn : null
}
```

---

## Module 2: EventBridge Bus

### Module Structure
```
modules/eventbridge-bus/
├── main.tf
├── variables.tf
├── outputs.tf
└── README.md
```

### main.tf
```hcl
# modules/eventbridge-bus/main.tf

resource "aws_cloudwatch_event_bus" "this" {
  name = var.bus_name

  tags = merge(
    {
      Name        = var.bus_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags
  )
}

# Archive (event replay capability)
resource "aws_cloudwatch_event_archive" "this" {
  count = var.enable_archive ? 1 : 0

  name             = "${var.bus_name}-archive"
  event_source_arn = aws_cloudwatch_event_bus.this.arn
  retention_days   = var.archive_retention_days

  event_pattern = var.archive_event_pattern
}

# Schema discovery
resource "aws_cloudwatch_event_bus_policy" "schema_discovery" {
  count = var.enable_schema_discovery ? 1 : 0

  event_bus_name = aws_cloudwatch_event_bus.this.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowSchemaDiscovery"
      Effect = "Allow"
      Principal = {
        Service = "events.amazonaws.com"
      }
      Action   = "events:PutEvents"
      Resource = aws_cloudwatch_event_bus.this.arn
    }]
  })
}
```

### variables.tf
```hcl
# modules/eventbridge-bus/variables.tf

variable "bus_name" {
  description = "Name of the EventBridge bus"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}

variable "enable_archive" {
  description = "Enable event archive (for replay)"
  type        = bool
  default     = false
}

variable "archive_retention_days" {
  description = "Archive retention period (days)"
  type        = number
  default     = 7
}

variable "archive_event_pattern" {
  description = "Event pattern for archive filtering"
  type        = string
  default     = null
}

variable "enable_schema_discovery" {
  description = "Enable schema discovery"
  type        = bool
  default     = false
}
```

### outputs.tf
```hcl
# modules/eventbridge-bus/outputs.tf

output "bus_name" {
  description = "Name of the EventBridge bus"
  value       = aws_cloudwatch_event_bus.this.name
}

output "bus_arn" {
  description = "ARN of the EventBridge bus"
  value       = aws_cloudwatch_event_bus.this.arn
}

output "archive_arn" {
  description = "ARN of the archive (if enabled)"
  value       = var.enable_archive ? aws_cloudwatch_event_archive.this[0].arn : null
}
```

---

## Module 3: DynamoDB Table

### main.tf
```hcl
# modules/dynamodb-table/main.tf

resource "aws_dynamodb_table" "this" {
  name           = var.table_name
  billing_mode   = var.billing_mode
  read_capacity  = var.billing_mode == "PROVISIONED" ? var.read_capacity : null
  write_capacity = var.billing_mode == "PROVISIONED" ? var.write_capacity : null
  hash_key       = var.hash_key
  range_key      = var.range_key

  dynamic "attribute" {
    for_each = var.attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  # Global Secondary Indexes
  dynamic "global_secondary_index" {
    for_each = var.global_secondary_indexes
    content {
      name               = global_secondary_index.value.name
      hash_key           = global_secondary_index.value.hash_key
      range_key          = global_secondary_index.value.range_key
      projection_type    = global_secondary_index.value.projection_type
      non_key_attributes = global_secondary_index.value.non_key_attributes
      read_capacity      = var.billing_mode == "PROVISIONED" ? global_secondary_index.value.read_capacity : null
      write_capacity     = var.billing_mode == "PROVISIONED" ? global_secondary_index.value.write_capacity : null
    }
  }

  # TTL configuration
  dynamic "ttl" {
    for_each = var.ttl_attribute != null ? [1] : []
    content {
      attribute_name = var.ttl_attribute
      enabled        = true
    }
  }

  # Point-in-time recovery
  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  # Server-side encryption
  server_side_encryption {
    enabled     = var.enable_encryption
    kms_key_arn = var.kms_key_arn
  }

  # Stream configuration
  dynamic "stream_enabled" {
    for_each = var.stream_view_type != null ? [1] : []
    content {
      stream_enabled   = true
      stream_view_type = var.stream_view_type
    }
  }

  tags = merge(
    {
      Name        = var.table_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags
  )
}
```

### variables.tf
```hcl
# modules/dynamodb-table/variables.tf

variable "table_name" {
  description = "Name of the DynamoDB table"
  type        = string
}

variable "billing_mode" {
  description = "Billing mode (PROVISIONED or PAY_PER_REQUEST)"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "read_capacity" {
  description = "Read capacity units (if PROVISIONED)"
  type        = number
  default     = null
}

variable "write_capacity" {
  description = "Write capacity units (if PROVISIONED)"
  type        = number
  default     = null
}

variable "hash_key" {
  description = "Hash key (partition key)"
  type        = string
}

variable "range_key" {
  description = "Range key (sort key)"
  type        = string
  default     = null
}

variable "attributes" {
  description = "Table attributes"
  type = list(object({
    name = string
    type = string
  }))
}

variable "global_secondary_indexes" {
  description = "Global secondary indexes"
  type = list(object({
    name               = string
    hash_key           = string
    range_key          = string
    projection_type    = string
    non_key_attributes = optional(list(string))
    read_capacity      = optional(number)
    write_capacity     = optional(number)
  }))
  default = []
}

variable "ttl_attribute" {
  description = "TTL attribute name"
  type        = string
  default     = null
}

variable "enable_point_in_time_recovery" {
  description = "Enable point-in-time recovery"
  type        = bool
  default     = false
}

variable "enable_encryption" {
  description = "Enable server-side encryption"
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
  type        = string
  default     = null
}

variable "stream_view_type" {
  description = "Stream view type (NEW_IMAGE, OLD_IMAGE, NEW_AND_OLD_IMAGES, KEYS_ONLY)"
  type        = string
  default     = null
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
```

---

## Environment Configuration Example

### environments/dev/main.tf
```hcl
# environments/dev/main.tf

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "talent-flow-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "TalentFlow"
      Environment = "dev"
      ManagedBy   = "Terraform"
      Owner       = "Engineering"
    }
  }
}

# EventBridge Bus
module "eventbridge_bus" {
  source = "../../modules/eventbridge-bus"

  bus_name                 = "talent-flow-bus"
  environment              = "dev"
  enable_archive           = true
  archive_retention_days   = 7
  enable_schema_discovery  = true
}

# DynamoDB Table
module "dynamodb_state_table" {
  source = "../../modules/dynamodb-table"

  table_name   = "talent-flow-state"
  hash_key     = "PK"
  range_key    = "SK"
  billing_mode = "PAY_PER_REQUEST"
  environment  = "dev"

  attributes = [
    { name = "PK", type = "S" },
    { name = "SK", type = "S" },
    { name = "GSI1PK", type = "S" },
    { name = "GSI1SK", type = "S" },
    { name = "GSI2PK", type = "S" },
    { name = "GSI2SK", type = "S" }
  ]

  global_secondary_indexes = [
    {
      name            = "GSI1"
      hash_key        = "GSI1PK"
      range_key       = "GSI1SK"
      projection_type = "ALL"
    },
    {
      name            = "GSI2"
      hash_key        = "GSI2PK"
      range_key       = "GSI2SK"
      projection_type = "ALL"
    }
  ]

  ttl_attribute                  = "ttl"
  enable_point_in_time_recovery  = false  # POC optimization
  enable_encryption              = true
}

# Lambda: API Handler
module "lambda_api_handler" {
  source = "../../modules/lambda-function"

  function_name    = "talent-flow-api-handler"
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 512
  timeout          = 10
  source_code_zip  = "../../lambda-packages/api-handler.zip"
  environment      = "dev"

  environment_variables = {
    EVENTBRIDGE_BUS_NAME = module.eventbridge_bus.bus_name
    DYNAMODB_TABLE_NAME  = module.dynamodb_state_table.table_name
    LOG_LEVEL            = "INFO"
  }

  iam_policy_statements = [
    {
      effect = "Allow"
      actions = [
        "events:PutEvents"
      ]
      resources = [module.eventbridge_bus.bus_arn]
    },
    {
      effect = "Allow"
      actions = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query"
      ]
      resources = [
        module.dynamodb_state_table.table_arn,
        "${module.dynamodb_state_table.table_arn}/index/*"
      ]
    }
  ]

  enable_dlq = true
}

# Lambda: Workflow Orchestrator
module "lambda_workflow_orchestrator" {
  source = "../../modules/lambda-function"

  function_name    = "talent-flow-workflow-orchestrator"
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 512
  timeout          = 30
  source_code_zip  = "../../lambda-packages/workflow-orchestrator.zip"
  environment      = "dev"

  environment_variables = {
    EVENTBRIDGE_BUS_NAME = module.eventbridge_bus.bus_name
    DYNAMODB_TABLE_NAME  = module.dynamodb_state_table.table_name
    LOG_LEVEL            = "INFO"
  }

  eventbridge_rule = {
    event_bus_name = module.eventbridge_bus.bus_name
    event_pattern  = jsonencode({
      source      = ["talent-flow.candidate"]
      detail-type = ["CandidateCreated"]
    })
  }

  iam_policy_statements = [
    {
      effect = "Allow"
      actions = [
        "events:PutEvents"
      ]
      resources = [module.eventbridge_bus.bus_arn]
    },
    {
      effect = "Allow"
      actions = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ]
      resources = [
        module.dynamodb_state_table.table_arn,
        "${module.dynamodb_state_table.table_arn}/index/*"
      ]
    }
  ]
}

# ... (Repeat for other 5 Lambdas)
```

---

## AI Code Generation Prompts

### Prompt: Generate Lambda Terraform Module Usage
```
Generate Terraform code to deploy the "vote-processor" Lambda function using the lambda-function module.

Requirements:
- Function name: talent-flow-vote-processor
- Runtime: nodejs20.x
- Memory: 256 MB
- Timeout: 15 seconds
- Triggered by EventBridge event: source="talent-flow.evaluation", detail-type="VoteSubmitted"
- Environment variables: EVENTBRIDGE_BUS_NAME, DYNAMODB_TABLE_NAME
- IAM permissions: EventBridge PutEvents, DynamoDB GetItem/PutItem/Query/UpdateItem
- Enable DLQ

Use the reusable lambda-function module located at ../../modules/lambda-function
```

---

## Deployment Workflow

### 1. Initialize Terraform
```bash
cd terraform/environments/dev
terraform init
```

### 2. Plan Changes
```bash
terraform plan -out=tfplan
```

### 3. Apply Changes
```bash
terraform apply tfplan
```

### 4. Validate Deployment
```bash
# Test API Handler Lambda
aws lambda invoke \
  --function-name talent-flow-api-handler \
  --payload '{"test": true}' \
  response.json

# Check EventBridge bus
aws events list-event-buses | grep talent-flow

# Query DynamoDB table
aws dynamodb describe-table --table-name talent-flow-state
```

---

## Best Practices

### 1. Use Remote State
```hcl
terraform {
  backend "s3" {
    bucket         = "talent-flow-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}
```

### 2. Use Workspaces for Environments
```bash
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod
```

### 3. Use Variables for Configuration
```hcl
# variables.tf
variable "environment" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "lambda_memory_size" {
  type = map(number)
  default = {
    dev     = 512
    staging = 512
    prod    = 1024
  }
}
```

### 4. Use Outputs for Cross-Module References
```hcl
# outputs.tf
output "eventbridge_bus_arn" {
  value = module.eventbridge_bus.bus_arn
}

output "dynamodb_table_name" {
  value = module.dynamodb_state_table.table_name
}
```

---

## Cost Optimization

### POC Environment
- Use PAY_PER_REQUEST for DynamoDB (no provisioned capacity)
- Disable point-in-time recovery
- Use arm64 Lambda architecture (20% cheaper)
- Enable DLQ (prevent lost events)
- Short log retention (7 days for POC)

### Production Environment
- Consider PROVISIONED capacity with auto-scaling (if predictable load)
- Enable point-in-time recovery
- Use reserved concurrency for critical Lambdas
- Longer log retention (30-90 days)

---

## Next Steps

1. ✅ Review Terraform module structure
2. ⏸️ Create reusable modules (lambda, eventbridge, dynamodb)
3. ⏸️ Configure dev environment
4. ⏸️ Deploy infrastructure with `terraform apply`
5. ⏸️ Validate resources in AWS Console
6. ⏸️ Run integration tests

---

**End of Terraform Module Structure Guide**

---
---

## 🆕 v2.0 Addendum: Metadata-Lite Architecture Updates

> **Added**: 2026-05-15
> **Document Version**: 2.0
> **Context**: MVP1 evolved to Metadata-Lite architecture (added config management layer)
> **See**: MVP1-FOUNDATION-PLAN-v2.md, DYNAMODB_SCHEMA_DESIGN.md v2.0 Addendum, LAMBDA_CATALOG.md v2.0 Addendum

---

### What Changed in v2.0

**v1.0**: 3 DynamoDB tables, 7 Lambda functions
**v2.0**: **4 DynamoDB tables** (+1: `talent-flow-config`), **8 Lambda functions** (+1: `config-manager`)

**New Infrastructure Components**:
1. **Config DynamoDB Table**: `talent-flow-config` with GSI1 for active config queries
2. **Config Manager Lambda**: Admin API for config CRUD with versioning
3. **Shared Utility**: `config-reader.js` (deployed with all Lambdas)
4. **Updated IAM Permissions**: All Lambdas need read access to config table

---

### New Module Usage: Config Table

#### Deploy Config Table

```hcl
# terraform/environments/dev/config-table.tf
module "config_table" {
  source = "../../modules/dynamodb-table"

  table_name   = "talent-flow-config"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attributes = [
    { name = "PK", type = "S" },
    { name = "SK", type = "S" },
    { name = "GSI1PK", type = "S" },
    { name = "GSI1SK", type = "S" }
  ]

  global_secondary_indexes = [
    {
      name               = "GSI1"
      hash_key           = "GSI1PK"
      range_key          = "GSI1SK"
      projection_type    = "ALL"
      read_capacity      = 0
      write_capacity     = 0
    }
  ]

  ttl_attribute                = "expiresAt"
  enable_point_in_time_recovery = false  # POC: disabled, Prod: enable
  enable_encryption             = true

  tags = {
    Environment = var.environment
    Project     = "talent-flow"
    Purpose     = "config-management"
  }
}

output "config_table_name" {
  description = "Config table name for Lambda environment variables"
  value       = module.config_table.table_name
}

output "config_table_arn" {
  description = "Config table ARN for IAM permissions"
  value       = module.config_table.table_arn
}
```

**Key Design Decisions**:
- **PAY_PER_REQUEST**: Low traffic (<15K reads/month after caching), on-demand cheaper than provisioned
- **GSI1**: Enables fast active config lookup (no need to scan all versions)
- **TTL**: Auto-deletes inactive config versions after 365 days (keeps audit year, then cleans up)
- **Encryption**: Enabled by default (AWS-managed key for POC, customer-managed for prod)

---

### New Module Usage: Config Manager Lambda

#### Deploy Config Manager Lambda

```hcl
# terraform/environments/dev/lambda-config-manager.tf
module "config_manager_lambda" {
  source = "../../modules/lambda-function"

  function_name = "talent-flow-config-manager"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  memory_size   = 256
  timeout       = 15
  architectures = ["arm64"]

  source_code_zip = "${path.module}/../../../lambda/config-manager/dist/function.zip"

  environment_variables = {
    CONFIG_TABLE_NAME = module.config_table.table_name
    LOG_LEVEL         = "INFO"
  }

  # IAM permissions for config CRUD
  custom_policies = [
    {
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ]
      Resource = [
        module.config_table.table_arn,
        "${module.config_table.table_arn}/index/GSI1"
      ]
    }
  ]

  enable_dlq = true

  tags = {
    Environment = var.environment
    Project     = "talent-flow"
    Component   = "config-management"
  }
}

# API Gateway integration (for admin UI)
resource "aws_lambda_permission" "config_manager_api_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.config_manager_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.execution_arn}/*/*"
}

output "config_manager_lambda_name" {
  value = module.config_manager_lambda.function_name
}
```

**Deployment Note**: config-manager Lambda needs **write** permissions (PutItem, UpdateItem), unlike other Lambdas which only need **read** permissions (GetItem, Query).

---

### Updated Lambda IAM Permissions (All Lambdas)

**v1.0 IAM Policy** (3 tables):
```hcl
custom_policies = [
  {
    Effect = "Allow"
    Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"]
    Resource = [
      module.state_table.table_arn,
      module.event_ledger_table.table_arn,
      module.workflow_state_table.table_arn
    ]
  }
]
```

**v2.0 IAM Policy** (4 tables + GSI access):
```hcl
custom_policies = [
  {
    Effect = "Allow"
    Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"]
    Resource = [
      module.state_table.table_arn,
      module.event_ledger_table.table_arn,
      module.workflow_state_table.table_arn,
      module.config_table.table_arn,              # NEW
      "${module.config_table.table_arn}/index/*"  # NEW (GSI1 access)
    ]
  }
]
```

**Apply to All Lambdas**:
- api-handler (reads config for validation rules)
- workflow-orchestrator (captures configVersion)
- interview-scheduler (reads PANEL_RULES)
- vote-processor (reads SCORING_WEIGHTS, PANEL_RULES)
- evaluation-completer (no config needed, but include for consistency)
- notification-service (reads NOTIFICATION_TEMPLATES)
- sla-monitor (reads SLA_THRESHOLDS)
- config-manager (needs PutItem, UpdateItem — use separate policy)

---

### Shared Utility Deployment: config-reader.js

#### Lambda Package Structure (Updated)

**v1.0 Structure**:
```
lambda/vote-processor/
├── index.js
├── package.json
└── node_modules/
```

**v2.0 Structure** (with shared utility):
```
lambda/
├── shared/
│   └── config-reader.js          # Shared across all Lambdas
├── vote-processor/
│   ├── index.js
│   ├── package.json
│   └── node_modules/
├── sla-monitor/
│   ├── index.js
│   ├── package.json
│   └── node_modules/
└── ... (other Lambdas)
```

#### Build Script (Updated)

```bash
#!/bin/bash
# scripts/build-lambda.sh

LAMBDA_NAME=$1

echo "Building Lambda: ${LAMBDA_NAME}"

# 1. Copy shared utility into Lambda directory
cp lambda/shared/config-reader.js lambda/${LAMBDA_NAME}/

# 2. Install dependencies
cd lambda/${LAMBDA_NAME}
npm install

# 3. Create deployment package
zip -r dist/function.zip index.js config-reader.js node_modules/

echo "✅ Lambda built: dist/function.zip"
```

**Usage**:
```bash
./scripts/build-lambda.sh vote-processor
./scripts/build-lambda.sh sla-monitor
./scripts/build-lambda.sh config-manager
```

**Important**: `config-reader.js` must be included in every Lambda package that reads config (all except api-handler and evaluation-completer).

---

### Seed Data Terraform Resource

#### Deploy Seed Configs via Terraform

```hcl
# terraform/environments/dev/config-seed-data.tf

# Option 1: Use null_resource to run seed script after table creation
resource "null_resource" "seed_configs" {
  depends_on = [module.config_table]

  provisioner "local-exec" {
    command = "CONFIG_TABLE_NAME=${module.config_table.table_name} node ${path.module}/../../../scripts/seed-config.js"
  }

  triggers = {
    table_name = module.config_table.table_name
  }
}

# Option 2: Use aws_dynamodb_table_item (static seed data)
resource "aws_dynamodb_table_item" "scoring_weights_v1" {
  table_name = module.config_table.table_name
  hash_key   = "PK"
  range_key  = "SK"

  item = jsonencode({
    PK      = { S = "TENANT#DEFAULT" }
    SK      = { S = "CONFIG#SCORING_WEIGHTS#v1" }
    GSI1PK  = { S = "TENANT#DEFAULT#ACTIVE" }
    GSI1SK  = { S = "CONFIG#SCORING_WEIGHTS" }
    configType = { S = "SCORING_WEIGHTS" }
    version    = { N = "1" }
    isActive   = { BOOL = true }
    data = {
      M = {
        technical      = { N = "0.30" }
        communication  = { N = "0.25" }
        culturalFit    = { N = "0.25" }
        problemSolving = { N = "0.20" }
      }
    }
    createdBy = { S = "SYSTEM" }
    createdAt = { S = "2026-05-15T08:00:00Z" }
  })
}

# Repeat for other 5 config types (SLA_THRESHOLDS, PANEL_RULES, etc.)
```

**Recommendation**: Use **Option 1** (seed script) for simplicity. Terraform-managed items (Option 2) are verbose and harder to maintain.

---

### Environment-Specific Config Example

**Use Case**: Different config defaults for dev/staging/prod.

```hcl
# terraform/environments/dev/variables.tf
variable "default_scoring_weights" {
  type = object({
    technical      = number
    communication  = number
    culturalFit    = number
    problemSolving = number
  })
  default = {
    technical      = 0.30
    communication  = 0.25
    culturalFit    = 0.25
    problemSolving = 0.20
  }
}

# terraform/environments/prod/variables.tf (different defaults)
variable "default_scoring_weights" {
  type = object({
    technical      = number
    communication  = number
    culturalFit    = number
    problemSolving = number
  })
  default = {
    technical      = 0.35  # Prod: Higher tech weight
    communication  = 0.25
    culturalFit    = 0.20
    culturalFit    = 0.20
  }
}
```

**Then seed accordingly**:
```bash
# Dev
terraform apply -var-file=dev.tfvars

# Prod
terraform apply -var-file=prod.tfvars
```

---

### Cost Optimization (Updated)

**v1.0 Cost**: $5.63/month (3 tables, 7 Lambdas)

**v2.0 Cost**: $6.15/month (4 tables, 8 Lambdas)

**Breakdown of Additional Cost**:
- Config table storage: +$0.25/month (100 MB)
- Config table reads: +$0.004/month (15K reads after 95% cache hit)
- Config-manager Lambda: +$0.02/month (~100 invocations/month)
- Other Lambdas (slight increase): +$0.25/month (config reads add +15ms cold start)

**Total Increase**: +$0.52/month (9% increase)

**ROI**: +$0.52/month saves R1.06M on vertical 2 launch (2,038,461:1 ROI 😄)

---

### Deployment Checklist (Updated)

**v1.0 Checklist**:
- [ ] Deploy 3 DynamoDB tables
- [ ] Deploy 7 Lambda functions
- [ ] Deploy EventBridge bus
- [ ] Deploy SQS queues
- [ ] Deploy API Gateway

**v2.0 Additions**:
- [ ] **Deploy config DynamoDB table** (`talent-flow-config` with GSI1)
- [ ] **Seed default configs** (run `scripts/seed-config.js` or Terraform null_resource)
- [ ] **Deploy config-manager Lambda** (with write permissions to config table)
- [ ] **Update 5 existing Lambdas** (vote-processor, sla-monitor, notification-service, interview-scheduler, workflow-orchestrator)
- [ ] **Include config-reader.js** in all Lambda packages (shared utility)
- [ ] **Update IAM policies** (all Lambdas need config table read access)
- [ ] **Verify admin UI** (3 config pages: scoring, SLA, panel rules)
- [ ] **Test config versioning** (change config, verify in-flight candidates unaffected)

---

### Terraform Commands (v2.0)

**Initialize Backend**:
```bash
cd terraform/environments/dev
terraform init
```

**Plan Changes**:
```bash
terraform plan -out=tfplan
```

**Apply Infrastructure**:
```bash
terraform apply tfplan
```

**Seed Configs**:
```bash
CONFIG_TABLE_NAME=$(terraform output -raw config_table_name) node ../../../scripts/seed-config.js
```

**Verify Deployment**:
```bash
# List Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `talent-flow`)].FunctionName'

# Verify config table
aws dynamodb describe-table --table-name talent-flow-config

# Query active configs
aws dynamodb query \
  --table-name talent-flow-config \
  --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"TENANT#DEFAULT#ACTIVE"}}'
```

---

### Best Practices (v2.0 Updates)

**1. Remote State** (No changes from v1.0)
- S3 backend with DynamoDB locking
- State file: `s3://talent-flow-terraform-state/dev/terraform.tfstate`

**2. Workspaces** (No changes from v1.0)
- Use for environment separation: `terraform workspace select dev`

**3. Variables** (Updated)
- **New variables** for config defaults (scoring weights, SLA thresholds, panel rules)
- Example: `var.default_scoring_weights` (see Environment-Specific Config Example above)

**4. Outputs** (Updated)
- **New outputs** for config table (table_name, table_arn)
- Used by Lambdas: `CONFIG_TABLE_NAME = module.config_table.table_name`

**5. Default Tags** (No changes from v1.0)
- Project: talent-flow, Environment: dev, ManagedBy: Terraform

**6. IAM Least Privilege** (Updated)
- All Lambdas: Read-only access to config table (`dynamodb:GetItem`, `dynamodb:Query`)
- Config-manager only: Write access (`dynamodb:PutItem`, `dynamodb:UpdateItem`)

---

### Multi-Tenancy Preparation (MVP3)

**v2.0 Foundation**: Config table already tenant-aware (`PK: TENANT#{tenantId}`)

**MVP3 Changes** (when multi-tenancy implemented):
```hcl
# Seed configs for multiple tenants
resource "null_resource" "seed_tenant_configs" {
  for_each = toset(["DEFAULT", "BANKING_CO", "AGRICULTURE_SA"])

  provisioner "local-exec" {
    command = "TENANT_ID=${each.key} CONFIG_TABLE_NAME=${module.config_table.table_name} node ${path.module}/../../../scripts/seed-config.js"
  }
}
```

**No infrastructure changes needed** — config table design already supports multi-tenancy.

---

### Summary of v2.0 Changes

**New Terraform Resources**:
- ✅ `talent-flow-config` DynamoDB table (with GSI1, TTL)
- ✅ `config-manager` Lambda function (admin API)
- ✅ Seed data resource (null_resource or aws_dynamodb_table_item)

**Updated Resources**:
- ✅ All Lambda IAM policies (add config table read permissions)
- ✅ Lambda packages (include config-reader.js shared utility)
- ✅ Lambda environment variables (add CONFIG_TABLE_NAME)

**New Outputs**:
- ✅ `config_table_name` (used by Lambda env vars)
- ✅ `config_table_arn` (used by IAM policies)

**Deployment Process Changes**:
- ✅ After `terraform apply`, run seed script to populate default configs
- ✅ Verify configs seeded: `aws dynamodb scan --table-name talent-flow-config`

**Cost Impact**: +$0.52/month (9% increase, negligible)

**Next Steps**:
1. Create config table Terraform module (T1.5 in MVP1-FOUNDATION-PLAN-v2.md)
2. Create config-manager Lambda Terraform module (T1.14)
3. Update existing Lambda modules with config table permissions (T1.14)
4. Create seed data script (T1.17)
5. Deploy infrastructure: `terraform apply`
6. Seed configs: `node scripts/seed-config.js`
7. Verify: Query active configs via GSI1

---

**v2.0 Addendum Complete**
**Last Updated**: 2026-05-15
**Related Documents**:
- MVP1-FOUNDATION-PLAN-v2.md (execution plan)
- DYNAMODB_SCHEMA_DESIGN.md v2.0 Addendum (config table schema)
- LAMBDA_CATALOG.md v2.0 Addendum (Lambda updates)
- PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)
