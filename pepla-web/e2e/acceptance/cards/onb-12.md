# ONB-12

Card: ONB-12 One new employee's page (NH-156)

Test files: `onb-12.spec.ts`

Spec: [NH-156](https://obsydian.atlassian.net/browse/NH-156)

Locks: acceptance-lock/onb-12, acceptance-lock/onb-12.2

`onb-12.spec.ts` AC-5 and AC-11 run the real `lambda/getEmployeeDocumentVerifications`
handler in its own Node process against a fake AWS (`support/onb-12/fake-aws`):
every AWS SDK and Powertools import is answered by a fake, the tables come from
made-up people, and every DynamoDB and KMS call is recorded. Nothing is installed
in the Lambda folder and nothing reaches AWS; importing an AI client fails the run.
They run once (in `desktop-1280`). `support/onb-12/openapi_route.py` reads
`api/openapi.yaml` (python3 and PyYAML).
