# ONB-07

Card: ONB-07 Batsi checks, HR decides (NH-163)

Test files: `onb-07.spec.ts`, `support/onb-07/`

Spec: [NH-163](https://obsydian.atlassian.net/browse/NH-163)

Locks: acceptance-lock/onb-07

AC-1 to AC-7 and AC-9 run the real `lambda/processDocumentOCR`, `lambda/sendNotificationEmail`,
`lambda/reviewDocumentVerification`, `lambda/getDocumentVerifications` and
`lambda/getEmployeeDocumentVerifications` handlers, each in its own fresh Node process (a cold
Lambda), against a fake AWS (`support/onb-07/fake-aws`). DynamoDB takes writes and honours
`ConditionExpression`; S3 holds the uploaded file; EventBridge, Step Functions, KMS, CloudWatch and
Postmark record what they are asked; Textract reads made-up lines or throws for an unreadable file;
the model answers made-up JSON with today's field names (`idNumber`, `surname`, `accountHolder`,
`confidence`, and a `decision` that must be ignored). Every Textract and Bedrock attempt is recorded,
even one the AI guard refuses. After each run the tables are carried to the next run, so "the same S3
event twice" is two cold starts on the same tables. Nothing reaches AWS, Postmark or any AI service,
and nothing is installed in the Lambda folders. These run once (in `desktop-1280`).

Events reach `sendNotificationEmail` the way `infra/eventbridge.tf` routes them (rules whose target
is that Lambda); AC-5 hands `document.waiting` to it directly so it does not depend on AC-9.
`support/onb-07/eventbridge.6b7f95b.tf.txt` is `infra/eventbridge.tf` as it was before this card
(test data for AC-9). `support/onb-07/openapi_checks.py` reads `api/openapi.yaml` (python3 and
PyYAML). AC-7 runs `scripts/ci/check-ai-guard.py`.

AC-8 runs on pepla-dev (desktop only, once): the employee test login uploads a small PDF through
the upload link and HR's routes are polled for 90 seconds. Its no-backend half runs the same upload
through the Lambdas on the fake AWS.
