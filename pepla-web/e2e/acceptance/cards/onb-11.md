# ONB-11

Card: ONB-11 Risk check on the full set (NH-181)

Test files: `onb-11.spec.ts`, `support/onb-11/`

Spec: [NH-181](https://obsydian.atlassian.net/browse/NH-181)

Locks: acceptance-lock/onb-11

AC-1 to AC-7 and AC-10 run once (in `desktop-1280`) with no screen. They run the real
`lambda/classifyOnboardingRisk`, `lambda/processDocumentOCR`, `lambda/getEmployeeDocumentVerifications`
and `lambda/getEmployee` handlers, each in its own fresh Node process, against `support/onb-11/fake-aws`
(copied from ONB-09's). Changes to the copy: DynamoDB index queries answer in pages (`LastEvaluatedKey`,
`ExclusiveStartKey`) and the document-verification table has an `employeeId-index`; Step Functions records
the token and output of each call and refuses a spent or unknown token; Bedrock can be told to fail with a
named error whose message is service text (it must never reach a log, BE-18); `fetch` is recorded and
refused. Nothing reaches AWS or any AI service. The model is a recording fake.
AC-6 reads `infra/step-functions/naleko-onboarding-flow.asl.json`. AC-10 reads `api/openapi.yaml` with
`support/onb-11/openapi_field.py` (python3 and PyYAML), and compares the three roles and five tables the
card touches with `support/onb-11/iam-542797c/baseline.json` (taken from develop 542797c).

AC-8 and AC-9 run with the no-backend app at 1280 and 390 wide (AC-9 at 390 only), with
`support/documents-fake.ts`.

AC-11 runs on pepla-dev only (desktop, once). It registers a `@blackhole.postmarkapp.com` test person, uploads
an ID and a bank statement, and reads HR's verifications answer. It never calls a model: the person is a test
login, so the answer is UNKNOWN with the AI-skipped label.

## Decided: Q2

Iggie decided Q2 (18 Nov): the page shows the model's sentence and both fixed guard sentences exactly as written. AC-8 checks both sentences against the strings in `lambda/shared/ai-guard.mjs`.

## Open: the risk block words (Q1)

The heading, the four result words and the "no check yet" line on the employee page risk block are Iggie's (Q1); the design kit gets the drawn block first, before the build. They are not invented here. Until they arrive,
`RISK_WORDS` in `onb-11.spec.ts` is null and AC-8 pins the block by structure only: the written reason shows
as written, each band's text differs from the others, and the "none yet" view has more text than the
employee's view. **The lock must not be pushed until Q1 is answered and `RISK_WORDS` is filled in.**

## Things for the builder

- BE-17 has a static order check on `classifyOnboardingRisk`: the guard must come before the first sensitive
  call. Keep `.send(` out of the handler body before `hrOrAgent`; put the flow logic in helper functions
  below the handler.
- `support/documents-fake.ts` is edited (shared): `StoredEmployee` gets optional `risk_band`, `risk_reason`
  and `risk_assessed_at`, and the fake's answer carries each key only when the stored employee has it.
  Nothing existing changes.

## What is new and what holds today

New (red on develop): the flow call (AC-1), the flow rules in the prompt (AC-3), the stored `FLOW`/`HR`
source and the no-repeat rule (AC-1, AC-4), the OCR signal rule (AC-5), the state machine (AC-6), the risk
keys for HR (AC-7), the page (AC-8, AC-9), the openapi fields (AC-10), pepla-dev (AC-11).
Hold today (and must keep holding): the web route unchanged and the marker refused from body, query, header
and event (AC-2), the AI guard half of AC-4, and the no-new-permissions half of AC-10.
