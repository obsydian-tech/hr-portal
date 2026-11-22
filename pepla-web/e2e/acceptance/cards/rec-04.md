# REC-04

Card: REC-04 (NH-238) Open roles: a role record, and the candidates of a role (epic NH-234, amber)

Test files: `rec-04.spec.ts` and `support/rec-04/` (`lambda-harness.ts`, `world.ts`, `callers.ts`, `iam.ts`, `pack-run.mjs`, `roles.ts`,
`seed-run.py`, `fake-aws/`, `iam-f55ab09/policies.json`).

Spec: `onboarding-cards/specs/REC-04.md`, read with REC-00 and the contract table of REC-UI-01. Review page:
`onboarding-cards/specs/REC-04-tests-for-review.md`.

Locks: rec-04 (the first tests)

## Scope

The coordinator split the card on 22 Nov 2026 (logged in `process/PIPELINE-DECISIONS.md`). This lock covers AC-1, AC-2, AC-4, AC-6, AC-8,
AC-9 and AC-10. AC-3 (PATCH /v1/roles/{id}), AC-5 (createCandidate needs a role) and AC-7 (the script that attaches old candidates to a role)
move to card REC-13 with their tests. The same decision puts the role routes on the TalentFlow API, next to the candidate routes, and adds
the app-side fix the hiring board needs on dev: the new app reaches the TalentFlow API, and that API's CORS lets the dev web address in.

## How the tests run

Control and AC-1 to AC-10 (the seed part) run once (`desktop-1280`) in the no-backend run. Each call runs the real handler (or the real shared
file) in a fresh Node process against a fake AWS (`support/rec-04/fake-aws`, REC-03's copy with the roles table's key added). Companies A
and B both hold the Standard pack. AC-8 and AC-9 also read code and Terraform as text; `iam-f55ab09/policies.json` is the grants of every
role on develop f55ab09, so AC-8 can tell which roles gained what. The seed part of AC-10 runs `seed_rec04` from `scripts/ci/seed-dev.py`
against an in-memory table (`support/rec-04/seed-run.py`: boto3 is replaced before the file loads, so nothing reaches AWS). The pepla-dev
part of AC-10 runs on pepla-dev only (`@pepla-dev`), in the company walk step of the dev run (it needs company B's 404). Nothing calls AWS
or any AI.

## Decisions the tests make where the card is silent (for the BA to confirm)

- D-T-1 The four role routes are served by one Lambda, `lambda/manageRoles`, routed by the route key (as REC-02's recordNotHired); its core
  is `lambda/shared/recruitment-actions/roles.mjs` (REC-00 rule 4).
- D-T-2 The role table is `talent-flow-roles` in talent-flow-infra (keys pk, sk), encrypted with the state table's key, point in time
  recovery on, pay per request; the Lambda reads its name from ROLES_TABLE_NAME. The candidate index is `role-id-index` on the state table
  (hash key role_id).
- D-T-3 `criteria` in POST /v1/roles is a list of `{ key, label }` or a list of text (as the Open a role page sends it): a text that is one
  of the company's default criteria keys takes its default label; any other text becomes the label. Stored as `[{ key, label }]`.
- D-T-4 POST /v1/roles without an Idempotency-Key header is 400 IDEMPOTENCY_KEY_REQUIRED. A key is one company's (TEN-02): the same key from
  the same company gives back the first answer and writes nothing; another company never gets that answer.
- D-T-5 A field error is 400 `{ error: 'Bad request', code: 'INVALID_FIELD', field }`. A title or department of only spaces is blank. The
  hiring manager error is 400 `{ error: 'Bad request', code: 'INVALID_HIRING_MANAGER' }`, the same words for every reason.
- D-T-6 The stored SLA words read as the screens' words: ON_TRACK stays, AT_RISK is DUE_SOON, BREACHED is OVERDUE. A role's overdue_count
  and due_soon_count count its open candidates in each.
- D-T-7 GET /v1/roles with no status lists open and closed roles; `status=OPEN` or `status=CLOSED` filters.
- D-T-8 A manager who is not a Recruiter lists and reads only the roles whose hiring_manager_id is their person id (REC-01 `callerId`); any
  other role is 404.
- D-T-9 GET /v1/candidates?role_id= lists the role's candidates of the caller's company (a manager: only their own, as today), Not hired
  left out unless stage=NOT_HIRED is asked for; each with id, name, stage (one of the six codes), role_id, level, sla_status and
  stage_entered_at. `counts` `{ all, mine, overdue, due_soon, not_hired }` count the role's candidates whatever the stage, sla_status,
  search and mine filters say (all = every one not Not hired). `search` matches the name whatever the case. `mine=true` lists counts.mine
  rows. A role of another company, or no role at all, is 200 `{ candidates: [], counts all 0 }`: the same answer. getCandidates reads the
  role row (ROLES_TABLE_NAME, GetItem) to know the role is the caller's company's.
- D-T-10 The dev seed is `seed_rec04(ddb, tenant_id, manager_sub)` in `scripts/ci/seed-dev.py`, called by `main()`. It writes the roles and
  the candidates REC-UI-01 AC-13 reads (`cards/rec-ui-01.md`), with fixed ids, again on every run, and puts them back to the seeded stage.
- D-T-11 The app's TalentFlow address is `talentFlowApiUrl` in pepla-web's environment (a .invalid placeholder in the repo; CI writes the
  real one in `scripts/ci/dev-frontend-env.sh`). Every Hire call of features/recruitment goes to it.
- D-T-12 Closing a closed role is 200 with the stored closed_at and closed_by, and writes nothing.
- D-T-13 manageRoles' role goes on the PII key's read list (`infra/kms.tf`, `dynamodb_read_role_arns`) in a second merge, after the role
  exists (REC-02's order). AC-8 allows it at most once and never on the encrypt list; AC-10 on pepla-dev proves the read works.

## Builder notes

- New: `lambda/manageRoles/index.mjs` (role check, then `requireTenant`, then `requireModule('recruitment')`, before any AWS call; then the
  core), `lambda/shared/recruitment-actions/roles.mjs`, `talent-flow-infra/talent-flow-roles.tf` (table, Lambda, role, policy, four JWT
  routes on the TalentFlow API).
- Open needs a Recruiter; list and one role a Recruiter or a manager; close a Recruiter.
- The hiring manager check is the picker's rule (getHiringManagers): in one of the hiring manager groups (`roles.mjs`
  HIRING_MANAGER_GROUPS, plus HM_GROUP_NAME when set), CONFIRMED, and a member of the caller's company (`membership.mjs`). It reads the
  pool with ListUsersInGroup and the company list with a Query: both are on manageRoles' policy.
- The counts and the close check read every page of `role-id-index`, with `tenantFilter`, and count open stages through `normaliseStage`
  (an old stage name counts by its new stage; a REJECTED or EVALUATION_FAILED row is Not hired).
- getCandidates: when `role_id` is in the query, hand the request to the core's candidate list. Its role gains exactly two lines: Query on
  `talent-flow-state/index/role-id-index` and GetItem on the roles table; its Lambda gets ROLES_TABLE_NAME.
- The state table gets the `role_id` attribute and the `role-id-index` (add-only; existing rows without role_id are not in it).
- TalentFlow API CORS: the allowed addresses move to a local; outside prod it adds `http://localhost:4300`, `http://127.0.0.1:4300` and the
  dev web address. Prod keeps the two it has today.
- `api/openapi.yaml` describes the four routes; `scripts/tenancy/ten-04-rows.json` gives each a walk row (byId rows use a candidate id: the
  walk has no role id kind yet, so it proves only the 404; AC-2, AC-4 and AC-10 prove company B's 404 on a real role).
- pepla-web: `talentFlowApiUrl` in `environment.ts`; `hire-api.ts` calls it; `scripts/ci/dev-frontend-env.sh` writes `${TF_API}`.
- `.github/workflows/app-e2e-dev.yml`: REC-04 AC-10's dev test leaves the main run and joins the company walk step.
- `scripts/ci/seed-dev.py`: `seed_rec04` (three roles; Fleet controller's eight candidates, Mpho Sithole on Warehouse supervisor as the old
  system's Not hired, Kagiso Molefe's sent offer). The manager login is hiring manager of Senior accountant only and of no candidate.
- Second merge (D-T-13): add `"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageRoles"` to `dynamodb_read_role_arns`
  in `infra/kms.tf`. Until then the module check on pepla-dev fails and the dev test stays red.

## Child lock rec-04.1 (older locked tests that the build would trip)

Lands with the build, in the same PR as REC-04's code. Each line makes room for exactly what this card adds and nothing more:
- `support/ten-04.2/grants.ts`: getCandidates' two new grants (Query on `role-id-index`, GetItem on the roles table).
- `mod-01.spec.ts`, `ten-03.spec.ts`: the per-role loops skip manageRoles (REC-04 AC-8 and AC-9 check it instead).
- `rec-02.spec.ts` AC-11: the "no new write grant" loop skips manageRoles (its writes are on the roles and idempotency tables only, AC-8).
- `chat-02.spec.ts` AC-31 and `ops-05.spec.ts` AC-7: the table count goes from 30 to 31 (the roles table).
- `chat-15.spec.ts` AC-12: manageRoles and the roles table are not "added" by CHAT-15; the PII key's read list may hold manageRoles once.
- `onb-22.spec.ts` AC-8, `ten-02.spec.ts` AC-13: manageRoles' role ARN is another card's line on the PII key's read list (the second
  merge, D-T-13).

## Child lock rec-04.2 (REC-14 step B)

`rec-04.spec.ts` and `support/rec-04/roles.ts`: a role is opened with `department_id` (an active department of the company), no longer
the `department` text. The fake world holds each company's departments list (from `support/rec-14/world.ts`); the three department text
cases are gone (rec-14.2 AC-6 holds the new refusals); the dev AC-10 sends the seeded department's id (`support/ten-04/dev-ids.json`).
