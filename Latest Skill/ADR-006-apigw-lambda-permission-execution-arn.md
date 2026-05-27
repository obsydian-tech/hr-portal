# ADR-006 — AWS API Gateway v2 Lambda Permission Must Use `execution_arn`, Not `arn`

| Field   | Value |
|---------|-------|
| Status  | **Accepted** |
| Date    | 2026-05-27 |
| Commit  | `c05fc72` |
| Author  | Ignecious Mushanguri |
| Relates | NH-145 / BE-010 (advanceCandidateStage) |

---

## Context

On 2026-05-27 the `PUT /v1/candidates/{id}/stage` endpoint returned HTTP 500
for all browser requests while every GET on the same API returned 200. Direct
CLI Lambda invocations (`aws lambda invoke`) worked perfectly. CloudWatch logs
contained zero entries for the failing requests, confirming Lambda was never
reached.

Root-cause investigation showed APIGW access logs had `"status":"500"` with
`"responseLength":"35"` (the fixed-length APIGW-own error body
`{"message":"Internal Server Error"}`). This pattern — 500 without any Lambda
log — is the signature of an **`AccessDeniedException`** on the Lambda resource
policy: APIGW silently returns 500 instead of 403 when it cannot invoke a
target Lambda.

The `advanceCandidateStage` Lambda permission had:

```hcl
# WRONG — aws_apigatewayv2_api.<name>.arn resolves to:
# arn:aws:apigateway:af-south-1::/apis/57l0w7kk9h
source_arn = "${aws_apigatewayv2_api.talent_flow_api.arn}/*/*"
```

HTTP API v2 (APIGW v2) sends an ***execute-api*** ARN as the caller context:

```
arn:aws:execute-api:af-south-1:937137806477:57l0w7kk9h/*/*
```

The two formats do **not** match. The `Condition.ArnLike` check in the Lambda
resource policy therefore always fails, and APIGW returns 500.

Every other Lambda permission in `talent-flow-apigateway.tf` correctly used
`.execution_arn`; this one file was authored separately and missed the pattern.

---

## Decision

**Always use `aws_apigatewayv2_api.<name>.execution_arn` (never `.arn`) when
constructing a `source_arn` for an `aws_lambda_permission` triggered by an
HTTP API v2 (APIGW v2) route.**

```hcl
# CORRECT
resource "aws_lambda_permission" "my_lambda_api" {
  statement_id  = "AllowAPIGWInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.my_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  # execution_arn → arn:aws:execute-api:REGION:ACCOUNT:API_ID
  # .arn          → arn:aws:apigateway:REGION::apis/API_ID   ← WRONG, never matches
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
```

The trailing `/*/*` covers all stages and methods; narrow it to
`/*/PUT/v1/candidates/*/stage` only when you need method-level restriction
(we do not, to stay flexible during refactors).

---

## ARN Cheat-Sheet

| Terraform attribute        | Resolves to                                               | Use for                          |
|----------------------------|-----------------------------------------------------------|----------------------------------|
| `.arn`                     | `arn:aws:apigateway:REGION::apis/API_ID`                  | Tagging, IAM policies on the API resource itself |
| `.execution_arn`           | `arn:aws:execute-api:REGION:ACCOUNT:API_ID`               | Lambda `source_arn`, IAM `execute-api:Invoke` |

---

## Diagnosis Checklist

When a route returns 500 with exactly 35 bytes and Lambda CloudWatch has
**zero** log lines for that invocation:

1. `aws lambda get-policy --function-name <name>` — print `Condition.ArnLike.AWS:SourceArn`
2. Compare against `arn:aws:execute-api:REGION:ACCOUNT:API_ID/*/*`
3. If it says `apigateway` instead of `execute-api`, or is missing the account
   ID — **that is the bug**. Run:
   ```bash
   aws lambda remove-permission --function-name <name> --statement-id <sid>
   aws lambda add-permission    --function-name <name> --statement-id <sid> \
     --action lambda:InvokeFunction \
     --principal apigateway.amazonaws.com \
     --source-arn "arn:aws:execute-api:REGION:ACCOUNT:API_ID/*/*"
   ```
4. Fix the Terraform `source_arn` to use `.execution_arn` and commit.

---

## Consequences

- All future Lambda permission blocks for APIGW v2 routes **must** reference
  `.execution_arn`. Code review should flag `.arn` in any `source_arn` whose
  principal is `apigateway.amazonaws.com`.
- The Terraform file for each Lambda+route uses a guard comment (see
  `talent-flow-advance-candidate-stage.tf`) to make the rule explicit at the
  point of definition.
- No other Lambdas were affected; all permissions in `talent-flow-apigateway.tf`
  already used the correct attribute.
