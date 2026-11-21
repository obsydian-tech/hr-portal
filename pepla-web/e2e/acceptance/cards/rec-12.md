# REC-12

Card: REC-12 (NH-246) Settings that are only names become real settings, with a Standard pack (epic NH-234, amber)

Test files: `rec-12.spec.ts` and `support/rec-12/` (`lambda-harness.ts`, `world.ts`, `callers.ts`, `iam.ts`, `standard.ts`, `pack-run.mjs`,
`fake-aws/`), plus the moved tests of other cards listed at the end (re-locked by rec-12.1).

Spec: `onboarding-cards/specs/REC-12.md`, read with REC-00. Review page: `onboarding-cards/specs/REC-12-tests-for-review.md`.

Locks: rec-12 (the first tests)

## How the tests run

AC-1 to AC-8 run once (`desktop-1280`) in the no-backend run. Each call runs the real handler (or the real shared file, or the real pack
script) in a fresh Node process against a fake AWS (`support/rec-12/fake-aws`, MOD-01's copy with code added only: a failure that hits only
the nth call, the tables printed after a helper run, a path tokenizer that takes `a.#name`, and a clock-based fake id so two runs never
make the same candidate id). AC-8 reads code and Terraform as text. AC-9 runs on pepla-dev only (`@pepla-dev`). Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (for the BA to confirm)

- D-T-1 A candidate's lock is `settingVersions`, a map of type to version number on the candidate's row; getCandidate returns it.
- D-T-2 The pack and the lock hold twelve types; WORKFLOW_TEMPLATES stays a name and is written nowhere.
- D-T-3 RETENTION is judged either way on a candidate's row (read at Not hired time).
- D-T-4 The render function is `renderTemplate(template, values)` in `lambda/shared/recruitment-settings.mjs`, answering `{ subject?, body }`.
- D-T-5 The gate that reads INTERVIEW_TYPES is today's (INTERVIEWING to EVALUATION); REC-03 moves it with its own lock.
- D-T-6 `{first_name}` (underscore) in the stored check-in and follow-up texts.
- D-T-7 The pack switches Screening on; its starting interview lists are the Interview Requirements page's own (`support/rec-12/standard.ts`; step 0, what dev and prod hold today, may change that one file).
- D-T-8 The old-default text check covers every `config-reader.js` copy and the two handlers that held fixed lists; stored-config reads in submitVote, submitVoteByToken and completeEvaluation are REC-02's.
- D-T-9 The audit row of a save is any new row holding type, from_version, to_version, by and at; its table is the builder's.
- D-T-10 A version that is no longer active is kept for good: no expiry time on it. Today's save sets a 365-day expiry on the old version, and a candidate locked to it would lose it.

## Builder notes

- New: `lambda/shared/recruitment-settings.mjs`, `lambda/shared/recruitment-stages.mjs`; rewrite `scripts/tenancy/module-seeds/recruitment.mjs` (`available` true, writes the pack through transactions, each Put conditional).
- Edit `manageTalentFlowConfig` (shape check, `expected_version`, audit row, no expiry on old versions), `captureSentiment`, `advanceCandidateStage`, `createCandidate` (writes `settingVersions`), the six `config-reader.js` copies (no fixed defaults), `scripts/ci/seed-dev.py` (calls the pack for company A).
- Terraform: createCandidate and captureSentiment get config table read grants (GetItem, Query, index) and `CONFIG_TABLE_NAME`; all readers need kms:Decrypt with the state key. Table rows are never written from Terraform.
- AC-9 logins: `E2E_TF` (Admin), `E2E_HR` (Recruiter), `E2E_HR_B`; the dev workflow step runs `set-modules` for company B before the test.
- A throwaway build that passes every no-backend test is at `/mnt/project-files/onboarding-cards/rec-12/REC-12-throwaway-build.patch`. It is not for merge.

## Existing locked tests that must change (listed for rec-12.1, to be found by running them on the build)

mod-01 AC-6 (the "not available yet" line), and the unit tests of advanceCandidateStage, captureSentiment and submitVote that read the old defaults.

## Child lock rec-12.1 (the moved assertions, found by running the older locked tests on the build)

Locks: rec-12.1 (this section and the test files below)

- `support/rec-01/routes.ts`, `support/mod-01/routes.ts`, `support/ten-03/routes.ts`, `support/ten-05/access.ts`: the POST and PUT `/v1/config` fixtures sent old-shape bodies (`{ x: 1 }`, `{ weights: ... }`). REC-12 refuses a body that is not the setting's shape (400 INVALID_SETTING), so each fixture now sends a valid RETENTION setting. Nothing else about those tests changes (who may call, which answer, what is written).
- `support/ten-04.2/grants.ts` (read by ten-03 AC-10, mod-01 AC-8, rec-01 AC-8): five more table-level grants the REC-12 readers need: createCandidate and captureSentiment Query the config table's active index and GetItem a version row; scheduleInterview Queries the active index (its role had GetItem only, so its read failed and the built-in defaults were used).
- `mod-01.spec.ts` AC-6: the Standard pack is no longer "not available yet". The seed prints how many settings it wrote; its writes go to the config table, which the "nothing else changed" comparison leaves out; the flip is now the last write and the seed's line comes before it; prod `--apply` turning Recruitment on now runs instead of being refused.
