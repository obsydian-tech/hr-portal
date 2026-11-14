# ONB-13

Card: ONB-13 Documents to check (NH-162)

Test files: `onb-13.spec.ts`, `support/onb-13/`

Spec: [NH-162](https://obsydian.atlassian.net/browse/NH-162)

Locks: acceptance-lock/onb-13

The page tests answer `GET <documentUploadApiUrl>/v1/verifications?waiting=true` in the browser
with made-up documents (`support/onb-13/waiting-fake.ts`), in the order the Lambda answers them.
Without `waiting=true` the fake answers today's list, so a page that leaves the flag off shows
nothing it should. HR home and employee pages in these tests use the shared employees and
documents fakes.

AC-2, AC-5 and AC-11 also run the real `lambda/getDocumentVerifications` and
`lambda/getEmployeeDocumentVerifications` handlers in their own Node process against a fake AWS
(`support/onb-13/fake-aws`): every AWS SDK and Powertools import is answered by a fake, the
tables are given row by row as DynamoDB stores them, a Scan answers four rows a page with
`LastEvaluatedKey` (so a reader that stops after one page misses documents), and every DynamoDB
and KMS call is recorded. A write or an AI client import fails the run. Nothing reaches AWS and
nothing is installed in the Lambda folders. "Today's answer" is
`support/onb-13/getDocumentVerifications.fffb9f2.mjs`, the Lambda as it was on develop before this
card; the Agent API and HR's list without `waiting=true` must answer exactly as it does. These
run once (in `desktop-1280`). `support/onb-13/openapi_list.py` reads `api/openapi.yaml` (python3
and PyYAML).

AC-5 and AC-8 also run on pepla-dev, and are expected to fail there until the merge deploys the
Lambda and the seed.
