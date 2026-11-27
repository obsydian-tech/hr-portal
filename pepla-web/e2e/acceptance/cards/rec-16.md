# REC-16

Card: REC-16 (NH-283) Hiring manager IT-bundle email when an offer is accepted (red: it emails a real person)

Test files: `rec-16.spec.ts` and `support/rec-16/` (`world.ts`, `lambda-harness.ts`, `terraform.ts`, `dev-ids.json`,
`baseline-9252f33.json`, `fake-aws/`). The fake AWS is a copy of REC-06's with code added only: a fake Postmark that answers the way the
real postmark 4.0.5 client does (sent, refused with a status code, timeout, dropped connection, an answer with no MessageID), another
run's guard row can land just before this run's first write (`landBeforeWrite`), and `load.mjs` loads a handler without calling it.

Spec: `onboarding-cards/specs/REC-16.md` (rules 1 to 11, AC-1 to AC-13) with its check `REC-16-spec-check.md`. Review page:
`onboarding-cards/specs/REC-16-tests-for-review.md`.

Locks: `acceptance-lock/rec-16` (these tests), and two child locks on top of it, one commit each:

- `acceptance-lock/chat-15.4`: chat-15 AC-12 lets in exactly the `notify_hiring_manager_on_hire` names and the
  `notifyHiringManagerOnHire` alarm name (this card's AC-13).
- `acceptance-lock/rec-16.1`: eleven older IAM checks that refuse any new role or policy leave out exactly REC-16's role and policy
  (key `infra/notify_hiring_manager_on_hire`, `support/rec-16.1/grants.ts`): int-01 AC-16, mod-01 AC-8, rec-02 AC-11, rec-04 AC-8,
  rec-07 AC-9, rec-15 AC-17, rec-15b AC-17, rec-15c AC-17, rec-15d AC-17, ten-02 AC-13 and ten-03 AC-10. ten-02 AC-13 also lets this
  one role read the PII key through its own IAM statement (kms:ViaService DynamoDB) instead of kms.tf's read list, as the spec decides;
  every other ten-02 check (Query only on the tenants table, no condition, no wildcard) still applies to it. The spec named only
  chat-15; these eleven were found by running the older suites on the throwaway build.

Nothing else locked moves. Push order: rec-16, chat-15.4, rec-16.1. Written against develop 9252f33.

## How the tests run

Everything except AC-7 (d) runs once (`desktop-1280`) in the no-backend run. Each delivery runs the real new handler in a fresh Node
process against the fake AWS. The events are the CandidateHired events REC-06's real accept put on the bus, for one offer in company A
(hiring manager hmA) and one in company B (hmB), both taken to ACCEPTED through REC-05's real routes. Terraform is read as text. AC-7 (d)
runs on pepla-dev only. Nothing calls AWS, Postmark or any AI.

## Decisions the tests make where the spec is silent (D-T-16.1 to D-T-16.7, for the BA to confirm)

- D-T-16.1 (rewritten by REC-16.2, NH-286, child lock `rec-16.5`) "Postmark answered" (refused: nothing went, so the claim is released
  and the Lambda retries) is an error whose `statusCode` is a whole number from 400 to 499 (401, 404, 408, 422, 429 ...). Everything else
  is "no answer" (the email may have gone): a 5xx (500, 502, 503, 504), any other status, a `statusCode` that is not a whole number or is
  missing, the client's PostmarkError with `statusCode` 0 (a timeout or a dropped connection), and an answer with no MessageID.
- D-T-16.2 The call is `sendEmail` with exactly From, To, Subject, TextBody, HtmlBody and MessageStream `outbound`. HtmlBody escapes
  `& < > " '`.
- D-T-16.3 Only SEND_FAILED throws (after the row is FAILED). Every other outcome returns normally. A missing or bad setting throws at load.
- D-T-16.4 One log line per run, one JSON object with only `outcome`, `offer_id`, `candidate_id` and, when there is one, `error` (an error
  name). A load-time failure logs nothing that names a person or an address.
- D-T-16.5 An event whose candidate_id or employee_id differs from the offer row ends OFFER_NOT_FOUND or OFFER_NOT_ACCEPTED; another
  company's offer ends OFFER_NOT_FOUND. A disabled or unconfirmed manager, or one with no Member row, ends HIRING_MANAGER_NOT_IN_COMPANY.
- D-T-16.6 The guard row keeps only PK, SK, status, claimed_at, offer_id, candidate_id, tenant_id, sent_at, message_id, recipient,
  hm_sub, failed_at and error; no value holds an @, the candidate's name, the subject or the body.
- D-T-16.7 The dev check reads the hm-it login as `E2E_HM_IT_EMAIL` / `E2E_HM_IT_PASSWORD` (`load-e2e-logins.py` key `hm-it`) and its
  ids from `support/rec-16/dev-ids.json`.

## Builder notes

- The Lambda is `lambda/notifyHiringManagerOnHire/` in `infra/`, every Terraform resource labelled `notify_hiring_manager_on_hire`, in
  the new file `infra/rec16-hm-it-email.tf`. `sendNotificationEmail`, `advanceOfferState`, manageOffers and the shared files listed in
  `support/rec-16/terraform.ts` (FROZEN_FILES, FROZEN_DIRS, OLD_PATH) stay byte for byte as on 9252f33.
- The recipient comes only from `hiringManagerPeopleOf` and the offer row, never from the event. The mode defaults to TEST_ADDRESS and
  `env/dev.tfvars` sets TEST_ADDRESS.
- Words: only the approved subject and body lines (the spec's wording section). No greeting or sign-off added.
- Add the Lambda to `infra/alarms.tf` `lambda_names` if you want the alarm (L-5); chat-15.4 allows exactly that name.
- `scripts/ci/check-lambda-settings.py` gets the new Lambda's entry. `lambda/notifyHiringManagerOnHire/package.json` and its
  `package-lock.json` carry `postmark` 4.x.

## REC-16 dev seed and login

`scripts/ci/seed-dev.py` (add-only) gets the `hm-it` persona (groups `manager`, a Member row in the founding company) and
`seed_rec16(ddb, tid, hm_sub)`, called from `main()` with the ids in `dev-ids.json`. Each run it deletes the employee REC-06 made for the
seeded offer (uuid5 id, on condition of the company, no scan) and the offer's guard row, puts the candidate back to OFFER and the offer
back to SENT with that person as hiring manager. `scripts/ci/load-e2e-logins.py` maps `"hm-it": "E2E_HM_IT"`. `startDate` is in 2030 so
it stays in the future. The seed and login text checks are part of AC-7 (d).

## REC-16.2 (NH-286): only a Postmark answer from 400 to 499 counts as refused. Child lock `acceptance-lock/rec-16.5`

Spec: `onboarding-cards/specs/REC-16.2.md` (rules 1 to 7, AC-1 to AC-7) with its check `REC-16.2-spec-check.md`. Review page:
`onboarding-cards/specs/REC-16.2-tests-for-review.md`. The card is REC-16.2 in Jira; the lock is `rec-16.5` because `rec-16.1` to
`rec-16.4` are taken. One commit on develop 47cdf6d. Build branch `fix/rec-16.2-postmark-refused`.

What the lock changes (code added only, nothing removed or loosened, apart from D-T-16.1's words above):

- `support/rec-16/fake-aws/postmark.mjs`: new answers `http400`, `http404`, `http408`, `http429`, `http499` (refused) and `http500`,
  `http502`, `http503`, `http504`, `http399`, `http600`, `statusString` ('422'), `statusFraction` (422.5), `statusNaN`, `statusMissing`
  (a TypeError, what 4.0.7 throws for an error answer with an empty body), each the class the real 4.0.7 client builds, code 0, and a
  message that names an address (`MARKER`). Two classes added with the real names: `RateLimitExceededError`, `ServiceUnavailablerError`.
  `new ServerClient(token, options)` records `{ service: 'postmark-client', op: 'ServerClient', argCount, options }`.
- `support/rec-16/world.ts`: `mayHaveSent` also counts the no-answer modes (`NO_ANSWER_162`); `clientsOf`; `otherWrites` leaves out the
  `postmark-client` record (making the client is not a write; REC-16.2 AC-4 judges it).
- `support/rec-16/lambda-harness.ts`: the new modes in `PostmarkMode`; comment 4.0.5 to 4.0.7.
- `support/rec-16.5/`: `index-47cdf6d.mjs.txt` (develop 47cdf6d's `lambda/notifyHiringManagerOnHire/index.mjs`) and
  `baseline-47cdf6d.json` (the sha256 of every file in that folder, `node_modules` left out).
- `rec-16.spec.ts`: D-T-16.1 rewritten; a new block `REC-16.2 ...` with AC-1, AC-2, AC-3, AC-4, AC-6 and AC-7. AC-5 is the REC-16
  block itself.

Decisions the tests make (D-T-16.2.x):

- D-T-16.2.1 A refused or no-answer run's single log line is exactly `{ outcome, offer_id, candidate_id, error }` with `error` = the
  class name. A name with the status in it (`UnknownError502`) fails.
- D-T-16.2.2 On no answer the guard row is exactly what the claim wrote (PK, SK, status SENDING, claimed_at, offer_id, candidate_id,
  tenant_id) and the claim is the run's only write.
- D-T-16.2.3 AC-7 allows only: line 32 replaced by one line that still starts `const mail = new postmark.ServerClient(TOKEN`, line 52
  replaced by one line that still starts `const answeredByPostmark = (e) =>`, and at most one added comment line (`// ...` or
  `/* ... */` on one line) right above each. Any other change, an added or removed file, or a changed `package.json` or
  `package-lock.json` fails.
- D-T-16.2.4 REC-16.2 AC-6 also pins the outcome of each answer (SEND_FAILED for 4xx, SEND_UNKNOWN otherwise), so unlike the spec's
  line "AC-6 passes before and after" it fails on develop for the 5xx, 399, 600 and 422.5 answers. Stricter, never looser.

For the builder: merge `acceptance-lock/rec-16.5` first, then change only `index.mjs` lines 32 and 52 (keep the name
`answeredByPostmark`, one line each). Nothing else in the folder.
