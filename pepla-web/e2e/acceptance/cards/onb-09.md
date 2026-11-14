# ONB-09

Card: ONB-09 Four steps everywhere (NH-166)

Test files: `onb-09.spec.ts`, `support/onb-09/`

Spec: [NH-166](https://obsydian.atlassian.net/browse/NH-166)

Locks: acceptance-lock/onb-09

AC-1 to AC-6, AC-9 and AC-10 run once (in `desktop-1280`) with no screen. They run the real
`lambda/cognitoPostAuth`, `lambda/processDocumentOCR`, `lambda/reviewDocumentVerification`,
`lambda/getEmployees` and `lambda/getEmployeeDocumentVerifications` handlers, each in its own fresh Node
process, against `support/onb-09/fake-aws` (copied from ONB-07's): DynamoDB takes writes and honours
`ConditionExpression`, answers Query and Scan in pages of four rows, has the `email-index` and
`created_by-index` indexes (an index can be given an older view than its table) and can be told to fail
chosen calls; EventBridge, S3, Step Functions and Postmark record what they are asked; Textract and Bedrock
are recording fakes. Every test person is a test login (the AI guard skips their documents) except one,
whose file Textract refuses, for the unreadable-file path. Nothing reaches AWS or any AI service.
AC-9 reads `api/openapi.yaml` with `support/onb-09/openapi_field.py` (python3 and PyYAML). AC-10 reads
`infra/*.tf` and compares the five roles with `support/onb-09/iam.five-roles.3076735.tf.txt`. AC-6 reads
`scripts/ci/seed-dev.py` with python3's `ast` and the old app's `OnboardingStage`.

AC-7 and AC-8 run with the no-backend app (AC-8 at 390 wide only). The shared fakes
`support/employees-fake.ts` and `support/documents-fake.ts` answer `step` the way the Lambdas now do: the
person's own `step` when a test gives one, else the step its stage gives. `support/help-02.ts` (HELP-02
reference) answers `step` the same way, through `answerHelpEmployees(context, { steps: true })` in
`support/journey-harness.ts`. The HELP-01 sign-in reference leaves `step` out, because the sign-in journey is locked
(HELP-02 AC-11 holds its hash) and sends none. None of these changes another card's assertions.

AC-11 runs on pepla-dev only (desktop, once) and only reads: HR's `GET /v1/employees` (every page) and
Naledi Dlamini's `GET /v1/employees/{id}/verifications`.
