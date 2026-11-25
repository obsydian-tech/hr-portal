# INT-03 · Stop logging raw guest tokens (NH-267, amber)

Spec: `/mnt/project-files/specs/interview-journey/cards/INT-03.md` (develop 7048cb9, spec checks rounds 1 and 2 applied).
Tests: `int-03.spec.ts`, support in `support/int-03/`. Lock: `acceptance-lock/int-03`. Build branch: `fix/int-03-token-logs`.

## Pinned by the test writer where the card is silent

- **D-T-03.1 AC-1 names.** Inside the arguments of any `console.*` call in any code file of `lambda/generateScoringLink/` and
  `lambda/submitVoteByToken/` (test files left out, new files included): the names `token`, `raw`, `hash`, `tokenHash` (as a value,
  shorthand `{ token }` included, a property name `{ token: 'x' }` is not a use); any property `.token`, `.tokenHash` or `.token_hash`
  on anything (the card names `rec.token` and `tokenRecord.token`); `event.body`, `event.rawPath`, `event.pathParameters` and anything
  under them; and any `.message` property (the card names `err.message`). `obj['token']` counts as `obj.token`. Strings and comments
  never count; `${...}` inside a template literal does.
- **D-T-03.2 AC-2 secrets.** Each run checks the token of its own path and every token of the test world, each as itself, as its
  SHA-256 in hex and in base64url, and as every 12-character run of the three. The old scoring page's address (which holds the token)
  is sent as the Referer, as a browser does.
- **D-T-03.3 Rule 2 at run time.** Every planted AWS error's message holds the word `INT03-ERRMSG` (and the token where the path knows
  it before the run). No log line may hold that word: a line that logs `err.message`, or the whole error, fails.
- **D-T-03.4 Rule 3.** In the runs where today's line used the token to tell records apart and the record is known (link made, existing
  link returned, either write fails, expired, already used, mark-used fails, and the forged-company link made), one log line names
  both the candidate id and the interview id. "Token not found" and "token read fails" have no record, so rule 3 does not apply there.
- **D-T-03.5 AC-3 values.** `support/int-03/expected-7048cb9.json` holds, for each run, develop 7048cb9's status, answer body, whether
  it threw, every row added, changed or removed (whole rows), and every EventBridge entry. Random tokens are replaced by names before
  the comparison. Recorded with `INT03_RECORD_EXPECTED=1` (that mode always fails, so it can never pass a build).
- **D-T-03.6 The publish path.** REC-14's fake DynamoDB does not answer `ReturnValues: UPDATED_NEW`, so the old vote path could never
  reach its quorum there. `support/int-03/updated-new.mjs` (test support, a preload) answers it with the new row. Nothing else changes.
- **D-T-03.7 Planted failures** are found by the call's key (for example the PutItem whose key is `CANDIDATE#…` / `SCORING_LINK#…`),
  not by its place in the order.
- **D-T-03.8 settings.test.js** is pinned by its SHA-256 on develop 7048cb9. A later card that changes it needs a child lock.

## INT-03 dev seed (AC-4)

`support/int-03/dev-ids.json` holds the candidate, interview, panel member and old-path token. `seed_int03` in
`scripts/ci/seed-dev.py`, called from `main()`, writes on every run, all in `talent-flow-state`:

- `CANDIDATE#<candidate>` / `SAGA`, copying seed-dev.py line 699: `tenant_id`, `configVersion` =
  `active_config_version(ddb, tenant_id, "SCORING_WEIGHTS")`, `GSI1PK`/`GSI1SK`, the `seed` tag, and a hiring manager that is not
  the manager test login (so `reset-dev-rec04.py` leaves it alone; the candidate is not named there).
- `CANDIDATE#<candidate>` / `INTERVIEW#<interview>` with `tenant_id`, `votesRequired: 99`, `votesSubmitted: 0`.
- `SCORING_LINK#<token>` / `META` and `CANDIDATE#<candidate>` / `SCORING_LINK#<token>`, fields as the card lists, `used: false`,
  `ttl` now + 7 days.
- It deletes the `VOTE#` rows the last run left.

The dev test votes once through `POST /v1/scoring/{token}/votes` (desktop only), waits up to 5 minutes for this vote's
"Token vote submitted successfully" line in `/aws/lambda/submitVoteByToken` (no line fails the check), then searches every line from
a minute before the vote for the token, both hashes and every 12-character run. It reads the logs with the AWS CLI as the dev test
step's role (`pepla-github-deploy-dev`, `app-e2e-dev.yml:173`). The token is a dev-only key to a throwaway candidate.
