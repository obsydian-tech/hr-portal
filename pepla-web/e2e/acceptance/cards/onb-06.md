# ONB-06

Card: ONB-06 Phone: documents and upload (NH-175)

Test files: `onb-06.spec.ts`, `support/onb-06/` (the browser fake, the Lambda harness and a copy of ONB-05's fake
AWS with S3 and the presigner added), and an additive change to `support/fixtures.ts`. No other locked test file is
changed.

Spec: [NH-175](https://obsydian.atlassian.net/browse/NH-175)

Locks: acceptance-lock/onb-06

After the privacy notice is accepted, `/start` lists the four documents (National ID, bank account confirmation
letter, matric certificate, tertiary qualifications) with a state each and "n of 4 complete", and each one opens its
own upload page at `/start/documents/:type`. A file picked there goes straight to S3 on a link the server hands out,
and shows "With HR" when S3 answers 2xx. The consent gate is on the new `/v1/me/documents` routes only. The old
`generateDocumentUploadUrl` route is OPS-04's.

Screen tests (AC-1 to AC-3, AC-5, AC-7, AC-8) run at 1280 and 390 wide with no backend; AC-9, the phone criterion, at
390 only. `support/onb-06/documents-fake.ts` answers `GET /v1/me/documents`, `POST /v1/me/documents/upload-url` and the
S3 `PUT` exactly as the spec fixes them. Its list is handed over unchanged: it never drops or renames a field. The one
thing it does itself (turn `autoRecord` off to stop it) is to put an uploaded file in the next list as "With HR", as the
server does. The API's CORS allows only `authorization` and `content-type`; the bucket's allows only `content-type` on a
PUT, no credentials. A PUT must carry the link's content type and exactly `fileSize` bytes, or S3 says 403.

Lambda tests (AC-2 to AC-6, AC-10) run the real `lambda/getMyDocuments`, `lambda/createMyUploadLink` and
`lambda/shared/upload-link.mjs` against `support/onb-06/fake-aws` (DynamoDB, KMS, S3 and the presigner faked, AI clients
refused, a fixed clock, every log line recorded), once, in `desktop-1280`. AC-10 also reads `infra/*.tf`, `api/openapi.yaml`
and `app.routes.ts` as text and runs `scripts/verify-design.mjs`. AC-11 runs on pepla-dev (`@pepla-dev`) and is red until
this card is merged and deployed.

## Words

Every word the page shows is one of the card's W-1 to W-11 (`/mnt/project-files/onboarding-cards/specs/ONB-06.md`,
approved by Iggie 16 Nov). Nothing here is new wording.

## Shared file changed with this card

`support/fixtures.ts`: add-only. It imports `MyDocumentsFake`, adds `myDocuments` to the fixture types and an automatic
fixture that installs it for every no-backend test (it answers the four types as not uploaded unless a test says
otherwise) and is null on pepla-dev. Nothing existing moved.

Locked test files this card touches: `support/fixtures.ts` only. It touches none of `onb-05`, `onb-13`, `onb-17`,
`onb-23` (MOD-02's) or any file TEN-02 changes.

## Where the tests read the spec in a way the builder should know

- The limit: "10 MB" is 10,000,000 or 10,485,760 bytes to different people. The tests use a 9.9 million byte file (must
  go) and a 10.5 million byte file (must not) and stay out of the gap. The server may take either number.
- An unverified email on the new routes is 403 with "This page is for new employees", as the spec says. The existing
  `getMyStart` answers 404 for it. Not changed here.
- `email_verified` is accepted as `true` or `'true'`, the way `lambda/shared/consent.mjs` `emailIsVerified` reads it.
  The spec says "any case"; `emailIsVerified` does not take `'TRUE'`. The tests follow the code. If the builder widens the
  helper, nothing here breaks.
- Tenancy (TEN-01) is in: a caller of company B gets 404 for company A's record, the row written and the rows read are the
  caller's company's. If TEN-02 changes the helper's calls, this test is re-locked with it.
- The "sidebar has no Documents item" check is true until ONB-19 adds the items, which re-locks that one line.
- "The old route is not touched" is a text check: `generateDocumentUploadUrl` neither uses `upload-link.mjs` nor mentions
  consent. OPS-04 adds the gate there and re-locks that line.
- The `pp-skeleton` loading state is not tested (it needs a slow answer the fake can't tell apart from a slow page).
- A sent-back row's button is assumed to carry the same word as a not-uploaded row of that type (W-2).
- The upload is a presigned `PUT` with `Content-Type` and the file as the body. A presigned POST form would fail these
  tests.
- The app's synced design-system wrappers still carry the old words: "Checked" and "n documents" on the checklist's progress
  bar, "Uploading, x%" and "Uploaded" on a file. The page needs the kit's: "Complete", "n of 4 complete", "Uploading,
  x of y MB", "With HR". Buttons on a phone are at least 44 pixels tall: the default (40) is not enough.
- Playwright answers a routed request itself, so the browser's preflight to S3 never reaches the test. What proves nothing
  but `Content-Type` goes to S3 is the headers of the PUT itself.
- ONB-24's AC-13 requires the sentence "We can't reach Naleko People. Check your connection and try again." to be written once, in
  `auth.messages.ts`, and imported elsewhere: the documents service imports `SIGN_IN_MESSAGES.offline`, it does not repeat it.
