# REC-15 step C: the candidate record (tests)

Jira: NH-278 (red). Spec: /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 2 (rules 12 to 18), AC-10 to AC-13, the record half
of AC-16 and step C's lines of AC-17, with the four fixes of onboarding-cards/specs/REC-15C-spec-check.md (C-1 to C-4).
Review page: onboarding-cards/specs/REC-15C-tests-for-review.md. Tests: pepla-web/e2e/acceptance/rec-15c.spec.ts, support/rec-15c/.

## Locks

- `acceptance-lock/rec-15c`: rec-15c.spec.ts, support/rec-15c (the world and the IAM baseline of develop 7048cb9) and this file.
- `acceptance-lock/rec-15c.1` (child lock, on top): older locked tests make room for step C.
  - support/rec-15c.1/grants.ts: `isRec15cGrant`, exactly the three reads on `talent-flow-infra/get_candidate` (GetItem on
    talent-flow-roles, GetItem on talent-flow-config, Query on talent-flow-config/index/GSI1-active-configs).
  - The exact-grant checks allow those three lines and nothing broader: mod-01 AC-8, rec-01 AC-8, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17,
    rec-15b AC-17, ten-03 AC-10.
  - rec-01 AC-3: the record holds no salary and no offer field for anyone (REC-15 rule 12). It used to require both for the Recruiter and
    `offer.state` for the hiring manager; the hiring manager's offer state is still checked on the offer route in the same test.
  - Fails on develop on purpose: rec-01 AC-3 (develop still sends the whole row with salary and offer). Every other older line passes on
    develop with the child lock.
- The builder merges both lock branches, never copies them.

## Decisions the tests pin where the spec is silent (D-T-C1 to D-T-C12, for the BA to confirm)

Full list in the header of rec-15c.spec.ts. The ones a builder is most likely to trip on:
- D-T-C1 exact keys per caller kind. settingVersions goes to the Recruiter only (spec check C-1). No other key, ever.
- D-T-C2 the stage, clock, role, level, dates and source equal the list row the same caller gets.
- D-T-C4 interviews_done and interviews_required are numbers from Interview on (Interview, Offer, Hired, Not hired), null before.
- D-T-C6 can_move and can_decide are compared with the real routes: anything but 403 or 404 counts as allowed (a 409 is "allowed but
  blocked"). Hired and a panel member: both false.
- D-T-C7 and C-2: the record never writes, also not the settings lock of an older row.
- D-T-C8 and C-3: every AWS call must be one getCandidate's role may make after step C.
- D-T-C10 a failed read is 500 { error: 'Something went wrong' }. A role row not found gives the stored title.
- D-T-C11 the three grants go inside the existing aws_iam_role_policy.get_candidate; ROLES_TABLE_NAME and CONFIG_TABLE_NAME on the Lambda.

## Notes for the builder

- The throwaway build that passes every test: /mnt/project-files/onboarding-cards/rec-15c/throwaway-build-C.NOT-FOR-MERGE.patch. A guide only.
- Read the settings without writing: a new reader next to getRecruitmentSettings (the throwaway's `settingsForRead`) that gives the
  candidate's locked versions where it has them and the active ones where it does not, and never calls UpdateItem.
- Put `requiredInterviews(settings, row, completedTypes)` in lambda/shared/recruitment-actions/candidate-progress.mjs and have
  moveCandidate call it (rule 14). Take can_move and can_decide from the same decider readings the routes use (moveCandidate reads
  `REJECTION_RULES.decider[level] ?? 'HR_ONLY'`; recordNotHired falls back to the Standard pack's rules when the setting is missing). The
  throwaway shares both through candidate-progress.mjs.
- The stage clock reads the active SLA_THRESHOLDS, as the list does (D-T-C2), not the candidate's locked version.
- Keep `requireModule` from modules.mjs in lambda/getCandidate/index.js (mod-01 reads it as text).
- Older test worlds (rec-01, rec-12, ten-03) have no roles table: a role read there throws "no table" in the fake. The throwaway falls
  back to the stored title on that, and lets every other error become the 500.
- NextStep and its blocker are nullable objects (`type: object`, `nullable: true`). OpenAPI 3.0 has no `type: 'null'`; the TEN-04 Redocly
  lint check (ten-04 AC-5) fails on it.
- Run `npm run api:types` in pepla-web after the openapi change.
- The new reads are of tables encrypted with the state key the role already holds: no KMS line changes (rec-15c AC-17 checks it).

## Dev check (standing line 11)

rec-15c's `@pepla-dev` test opens the seed's Tendai Ncube (CAND-SEEDREC040000000000004, Fleet controller) as the HR login after deploy:
200, no internal key, role_title "Fleet controller", next_step and interviews_required present, the answer passes the schema; the manager
login and company B get 404. A missing grant or key line shows there as a 500.

**Where it runs (lock check FX-4).** On pepla-dev, company B (`E2E_HR_B`) has Recruitment off, so in the main dev run B gets the
module's 403, not 404. Like REC-02 AC-12, REC-03 AC-11, REC-04 AC-10 and REC-05 AC-11, this test runs in the "Company walk (TEN-04)" step
of `.github/workflows/app-e2e-dev.yml`, where `E2E_HR_B` is the walk company (Recruitment on). The builder adds
`REC-15 step C .* AC-17 on pepla-dev` to that step's `--grep` and to the main run's `--grep-invert` (the workflow is not a locked file).
Without it the dev run goes red on every merge after this one (rule 8).
