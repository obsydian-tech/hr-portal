# ONB-08

Card: ONB-08 Required documents and when Verified is reached (NH-165)

Test files: `onb-08.spec.ts`, `support/onb-08/`

Spec: [NH-165](https://obsydian.atlassian.net/browse/NH-165)

Locks: acceptance-lock/onb-08

AC-1, AC-2, AC-3, AC-4 (first half), AC-5 and AC-8 run once (in `desktop-1280`) with no screen. They run
the real `lambda/reviewDocumentVerification` and `lambda/getEmployeeDocumentVerifications` handlers, each
in its own fresh Node process, against ONB-15's fake AWS (`support/onb-15/lambda-harness.ts` and
`support/onb-15/fake-aws`, used as they are): DynamoDB takes writes and honours `ConditionExpression`,
EventBridge and CloudWatch record what they are asked, any AI client import fails the run. Nothing
reaches AWS. AC-1 also imports `lambda/shared/required-documents.mjs` in a fresh Node process and reads
`REQUIRED_DOCUMENT_TYPES` and `requiredFor()`. AC-8 reads `api/openapi.yaml` with
`support/onb-08/openapi_fields.py` (python3 and PyYAML).

AC-4 (second half), AC-6 and AC-7 run at 1280 and 390 wide with the no-backend app.
`support/onb-08/employee-fake.ts` answers `GET /v1/employees/<id>/verifications` with ONB-12's answer
(`support/documents-fake.ts`) plus `required_documents`, or without that field. Cognito is the shared fake.

AC-9 runs on pepla-dev only (desktop, once). The employee test login (`E2E-EMP-0001`, reset by the seed to
INVITED with no documents) uploads a National ID and a Bank confirmation, both are read within 90 seconds,
HR accepts the ID (stage DOCUMENTS_SUBMITTED), then the bank letter (`employee_stage_updated` true, stage
VERIFIED). It decides only its own two uploads, never a seeded document. It leaves the test employee
VERIFIED until the next seed; no later pepla-dev check reads his stage. It is red on pepla-dev until the
merge deploys the Lambda (ONB-07 AC-8's older undecided bank letter blocks Verified under today's rule).
