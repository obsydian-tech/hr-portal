# ONB-15

Card: ONB-15 HR accepts a document or asks for a new one (NH-164)

Test files: `onb-15.spec.ts`, `support/onb-15/`, and AC-4 of `onb-13.spec.ts` (moved, see below)

Spec: [NH-164](https://obsydian.atlassian.net/browse/NH-164)

Locks: acceptance-lock/onb-15

The page tests run at 1280 and 390 wide with no backend: `support/onb-15/document-fake.ts` answers
`GET /v1/verifications/<id>`, `PATCH /v1/verifications/<id>/review` and `GET /v1/documents/<id>/url`
the way the card says the Lambdas will, and records every call. Cognito is the shared fake.

AC-3, AC-5, AC-6, AC-7 and AC-12 also run the real `lambda/getSingleDocumentVerification`,
`lambda/getDocumentPresignedUrl` and `lambda/reviewDocumentVerification` handlers, each in its own
fresh Node process (a cold Lambda), against a fake AWS (`support/onb-15/fake-aws`, from ONB-07's):
DynamoDB takes writes and honours `ConditionExpression`, KMS decrypts "kms:" ciphertext, the S3 URL
signer returns a made-up link, EventBridge and CloudWatch record what they are asked. Any AI client
import fails the run. Nothing reaches AWS. These run once (in `desktop-1280`).

AC-12 reads `infra/*.tf` as text: only `getSingleDocumentVerification`'s role and policy are compared
with `support/onb-15/iam.get_single_document_verification.304dcbc.tf.txt` (the two resources as they
were at 304dcbc). `support/onb-15/openapi_route.py` reads `api/openapi.yaml` (python3 and PyYAML).

AC-5 runs on pepla-dev (desktop only, once) against Naledi's seeded bank document
`doc_1762243200000`: the employee login gets 403 from all three routes (the PATCH is refused before
any read), the HR login gets 200 from the two GETs. It never decides a seeded document.

## ONB-13 AC-4 moved with this card

ONB-13 AC-4 checked the holding page at `/hr/documents/<id>` ("Document" heading, one line, no API
call). This card replaces that page, so in the same lock commit only that test changed:

- `HOLDING_LINE` is gone.
- `expectHolding` now checks the URL and the heading "Bank confirmation, Naledi Dlamini", answered by
  an ONB-15 `DocumentFake` installed inside the test.
- "calls no API" is now "calls only `GET /v1/verifications/<id>`" (OPTIONS and an `employee_id` query
  allowed), and the page must make that call.

What the criterion checks is unchanged: the row opens the document's page by mouse, by keyboard and
straight from the address after sign-in, and the name opens the employee page. `cards/onb-13.md` is
not touched; it belongs to the ONB-13 locks.
