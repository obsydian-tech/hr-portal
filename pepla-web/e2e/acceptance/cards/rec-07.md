# REC-07

Card: REC-07 (NH-241) Scoring per role: 1 to 5 per criterion, plain averages, one guest link (epic NH-234, amber)

Test files: `rec-07.spec.ts` and `support/rec-07/` (`world.ts`, `dev-ids.json`, `iam-bc0fada/policies.json`, `iam-bc0fada/roles.json`). The
tests reuse REC-14's fake AWS and harness, REC-02's company rows and Standard pack run, REC-02's Terraform reader and REC-15's clock, all
unchanged.

Spec: `onboarding-cards/specs/REC-07.md`, read with REC-00 and the contract table of REC-UI-03. Review page:
`onboarding-cards/specs/REC-07-tests-for-review.md` (the bar and the proofs).

Locks: rec-07 (these tests). A child lock rec-07.1 carries any older locked assertion this card moves (see the review page).

## How the tests run

AC-1 to AC-9 and the seed part of AC-10 run once (`desktop-1280`) in the no-backend run. Each call runs the real handler in a fresh Node
process against the fake AWS, at one fixed time (24 Nov 2026 08:00 UTC). AC-9 reads Terraform and api/openapi.yaml as text;
`iam-bc0fada/` holds every role and grant on develop bc0fada, so AC-9 can tell what a branch added. The pepla-dev part of AC-10 runs on
pepla-dev only (`@pepla-dev`). Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (D-T-7.1 to D-T-7.13, for the BA to confirm)

The full list is in the header of `rec-07.spec.ts`. The ones a builder is most likely to trip on:

- D-T-7.1 The new person routes are submitVote's (POST /v1/interviews/{id}/votes, GET /v1/candidates/{id}/scores) and the public ones
  submitVoteByToken's (GET and POST /v1/scoring-links/{token}). The handlers tell them apart by the route key. The old routes stay.
- D-T-7.3 A candidate with no role gets the company's default criteria when the interview is scheduled.
- D-T-7.6 The interview row carries PANEL_FEEDBACK_PENDING_COUNT, PANEL_SPLIT_FLAG and PANEL_CONSENSUS (the spec's names).
- D-T-7.8 A panel member's answers (the sheet and the interview list) must not move when another member's vote changes. So they carry no
  mean, split or consensus, which are worked out from others' votes.
- D-T-7.9 The final score reaches the candidate row the way it does today (finalScore, from VotingCompleted's averageScore). What
  changes is the number: submitVote publishes the event with rule 5's final score worked out from the stored votes, unrounded.
- D-T-7.11 The single refusal of the public routes is today's expired answer, the whole response object (410, Content-Type, body).

## REC-07 dev seed

`scripts/ci/seed-dev.py` gets `seed_rec07(ddb, ...)`, called from `main()`, and puts these rows back on every run, so the dev check can
score again each time (votes of the last run removed, links unused):

- Company A (the founding company) candidate `CAND-REC07DEVAAAAAAAAAAAAAA1` in Interview, with a role whose criteria are the Standard
  pack's default criteria, hiring manager = the E2E_MANAGER login.
- Its interview `iv-rec07-dev-1`, criteria_snapshot = those criteria, panel = the person ids of the E2E_EMP and E2E_IT logins, no votes.
- A guest link for that interview, stored as the build stores links (hashed), for the raw token `rec07DevGuestLinkSeededEveryRunAAAAAAAAAAA`,
  unused, expiring 7 days after the seed runs.
- A company B candidate and interview, and a link row for the raw token `rec07DevCrossCompanyLinkSeededEveryRunAAAA` that names company A
  but points at B's interview (the dev form of AC-7's forged row).

The ids are in `support/rec-07/dev-ids.json`. The E2E_GUEST login is on no panel.

## Notes for the builder

- The throwaway build that passes every test is in /mnt/project-files/onboarding-cards/rec-07/rec-07-throwaway-build.patch. A guide, not
  the answer: it keeps the old routes as they are and its dev seed is empty.
- The interview is found by its own id. The throwaway build adds a state-table index on interviewId; any other way that AC-9 allows is fine.
- Run `npm run api:types` in pepla-web after the openapi change.
