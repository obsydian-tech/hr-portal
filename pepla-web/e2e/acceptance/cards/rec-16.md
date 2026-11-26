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

- D-T-16.1 "Postmark answered" is an error with a numeric `statusCode` above 0 (the client's HttpError family). "No answer" is the
  client's PostmarkError with `statusCode` 0 (a timeout or a dropped connection), and an answer with no MessageID counts as no answer.
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
