# REC-03

Card: REC-03 (NH-237) Six stages, a reason on every move, and the old rows moved over (epic NH-234, amber)

Test files: `rec-03.spec.ts` and `support/rec-03/` (`lambda-harness.ts`, `world.ts`, `callers.ts`, `iam.ts`, `standard.ts`, `pack-run.mjs`,
`move.ts`, `fake-aws/`, `iam-5a6b4ef/policies.json`).

Spec: `onboarding-cards/specs/REC-03.md`, read with REC-00. Review page: `onboarding-cards/specs/REC-03-tests-for-review.md`.

Locks: rec-03 (the first tests)

## How the tests run

Control and AC-1 to AC-10 run once (`desktop-1280`) in the no-backend run. Each call runs the real handler (or the real shared file, or the
real migration script) in a fresh Node process against a fake AWS (`support/rec-03/fake-aws`, REC-02's copy, unchanged). Companies A and B
both hold the Standard pack. AC-1, AC-6 and AC-10 also read code and Terraform as text; `iam-5a6b4ef/policies.json` is the grants of every
role on develop 5a6b4ef, so AC-10 can tell that advanceCandidateStage's role gained nothing. AC-11 runs on pepla-dev only (`@pepla-dev`).
Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (for the BA to confirm)

- D-T-1 Moves stay on PUT /v1/candidates/{id}/stage (advanceCandidateStage); its core is `moveCandidate` in
  `lambda/shared/recruitment-actions/move-candidate.mjs` (REC-00 rule 4).
- D-T-2 `normaliseStage` lives in `lambda/shared/recruitment-stages.mjs` next to `STAGE_CODES`. It takes a stage or a candidate row
  (`{ currentStage, status }`) and gives one of the six codes; it also maps PHONE_SCREENING, TECHNICAL_INTERVIEW and PANEL_INTERVIEW, as
  REC-02 does. The file exports no list or map that holds an old name.
- D-T-3 The one-list text check covers every Lambda of the TalentFlow stack, the Recruitment shared files (recruitment-*.mjs,
  recruitment-actions/, config-reader.js, tf-*.js) and the Standard pack seed. Comments, tests, packages and the one-off scripts at the top
  of lambda/ are left out. Old names may stay only in `recruitment-stages.mjs` and the migration script.
- D-T-4 The body is `{ to, reason }`. A `to` that is not one of the six codes is 400 (code not pinned). A reason that is missing, not
  text, only spaces, or over 1000 characters is 400 REASON_REQUIRED.
- D-T-5 With Screening off the list is Applied, Interview, Offer: Applied moves to Interview, Interview moves back to Applied, and a move to
  Screening is 400.
- D-T-6 A move to the stage the candidate is in, and two steps back, are 400 (code not pinned).
- D-T-7 A manager who is not the candidate's hiring manager gets 403 or 404 (not pinned); nothing is written.
- D-T-8 The history row stays where today's is (state table, SK `STAGE#...`). Its fields may carry the card's names (from, to, by, at) or
  today's (fromStage, toStage, actor, timestamp); `reason`, `by_kind` = PERSON and tenant_id are on it. The reason text is stored on that
  row only: not on the candidate's row, not in any event, not in the logs.
- D-T-9 getCandidateEvents lists each move with its from and to and who moved, oldest first. A Recruiter and the hiring manager see the
  reason; a panel member sees the move without it (the REC-02 review: free text must not reach panel members or Ask Batsi).
- D-T-10 One CandidateMoved per move. Another event may still be sent, but none is EvaluationCompleted and none carries the reason.
- D-T-11 "createOffer has no event entry point" is judged in createOffer: an EvaluationCompleted event writes, starts and sends nothing.
  The Terraform rule that still points the event at createOffer may stay: removing it is a delete, which waits for Iggie.
- D-T-12 The level is today's `positionLevel`. It is locked (409 LEVEL_LOCKED) in Interview, Offer and Hired (stored old names count
  through normaliseStage), and in Applied or Screening once any interview row exists. Other fields stay editable.
- D-T-13 The migration script follows `scripts/tenancy/move-default.mjs`: --env dev|prod, --tenant, dry run by default, --apply, --check;
  the account is checked against --env before anything is read; a prod --apply also needs --prod-account 937137806477. It reads every
  page. "The old rejection time" is `evaluationCompletedAt`. The row keeps `status`; only `currentStage` (and `updatedAt`) of its old fields
  change. The history row carries reason_code STAGE_LIST_CHANGE and no reason text.
- D-T-14 The dry run prints the number of rows it would move.
- D-T-15 CandidateMoved's role_id is the candidate's role_id (null when it has none), as REC-02's event does.
- D-T-16 Batsi's pipeline overview filters and counts by the six codes: a stored old name is read through normaliseStage, and the tool's
  own description names no old stage and no REJECTED.

## Builder notes

- New: `lambda/shared/recruitment-stages.mjs` gets `normaliseStage` (today it holds only `STAGE_CODES`);
  `lambda/shared/recruitment-actions/move-candidate.mjs` (the core); `scripts/recruitment/migrate-stages.mjs`.
- advanceCandidateStage: role check (Recruiter or manager, REC-01's `requireRecruiterOrManager`), then `requireTenant`, then
  `requireModule('recruitment')`, before any AWS call; then the core. A hiring manager may make one move only, Interview to Offer under
  `HR_OR_HM`; refuse anything else before reading the settings, or rec-01 AC-2 sees a write (the settings lock) on a refusal.
- The history row's key must not carry a random part: ten-06 AC-4 runs every handler twice and compares the rows (a time or a UUID is
  fine, both are masked).
- updateCandidate: the level lock reads the candidate's interview rows. Its role has GetItem and UpdateItem on the state table only: add
  `dynamodb:Query` on the state table (table ARN only, add-only; child lock rec-03.1 allows exactly that grant).
- getCandidateEvents: adds the stage history rows (`STAGE#...` on the state table) to the list in time order; a panel member's copy has no
  reason. Its role already reads the state table.
- talentFlowAiChat `tool-resolver.mjs`: the pipeline overview reads through `normaliseStage` and never hands back a move's reason.
- createOffer: remove the event path; the person path (POST /v1/candidates/{id}/offer) is unchanged.
- Every other old name in the TalentFlow Lambdas and the six `config-reader.js` copies goes (AC-1 lists the files it found on develop).
  `lambda/scheduleInterview/index.test.js` checks today's message ("INTERVIEWING"): change that unit test with the code.
- `api/openapi.yaml`: the stage operation's request body becomes `{ to, reason }` and lists 400, 403, 404 and 409.
- The old Angular app (`hr-portal/src/app/features/talent-flow/`) still sends `{ newStage }`; after this card that is a 400. Its screens
  are REC-UI cards.
- Terraform: no new Lambda, no new role, no new grant for advanceCandidateStage (AC-10 compares with `iam-5a6b4ef`). No role is added to
  the KMS read list. The EventBridge rule that sends EvaluationCompleted to createOffer is a delete and waits for Iggie (D-T-11).
- `scripts/ci/seed-dev.py`: seed `CAND-SEEDREC030000000000001` (company A, APPLIED, MID, one interview row), `CAND-SEEDREC030000000000002`
  (company A, INTERVIEWING) and `CAND-SEEDREC030000000000003` (company A, EVALUATION, status REJECTED, evaluationCompletedAt set); reset
  them and run `migrate-stages.mjs --env dev --tenant <dev company A> --apply` on every seed run, before AC-11.
- AC-11 logins: `E2E_TF` (Admin, turns Screening on for the run), `E2E_HR` (Recruiter), `E2E_MANAGER` (hiring manager), `E2E_HR_B` (company B).
- Prod: the migration on prod is Iggie's ("run the REC-03 stage move in prod 937137806477"), with `--prod-account`.
- A throwaway build that passes every no-backend test is at `/mnt/project-files/onboarding-cards/rec-03/REC-03-throwaway-build.patch`.
  It is not for merge.
