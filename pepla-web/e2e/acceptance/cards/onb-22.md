# ONB-22 acceptance notes (The same rules through the Agent API and MCP, NH-183)

Files: `onb-22.spec.ts` (35 tests, AC-1 to AC-10) and `support/onb-22/` (fake AWS harness, develop baseline `baseline-c859f0f.json`, dev seed contract `dev-ids.json`). New files only, no child locks, no locked file changed.

## Pinned choices (also in the spec header)
- P1 A run that is refused or fails still answers 200 to the approve call, with `run_status` and a code only.
- P9 Approve and decline are on the HR sign-in (JWT) and use the token's company (`x-tenant: token`).
- P10 The summarise and MCP rights are second policy resources, because ten-02 pins their existing policies byte for byte.
- P2 to P8 as in the spec header (expiry in epoch seconds, ISO createdAt, seed contract, and so on).

## Lock
Push `acceptance-lock/onb-22` and `acceptance-lock/ten-04.4` (same commit), after the independent check.

## Locked specs that stay green with a correct build
ten-02, be-17.1, be-18, be-19, be-20, ops-05, onb-20 AC-8.
ten-04 AC-7 goes red: its rows list approve and decline as `covered`, which wants an agent-key caller, and ONB-22 moves those two routes to the HR sign-in. Fix, IN this commit (coordinator's call, 18 Nov): two-row child lock of `support/ten-04/rows.ts`. Push it as `acceptance-lock/ten-04.4` (or the next free name) AFTER ten-04.3 (PII-01), since both edit ten-04 files; merge the lock commit, do not hand-copy.

## Owed
- Step 0 (prove the code findings on dev with AWS reads): a Mac thread.
- AC-7 (pepla-dev) runs only after the seed change and a dev deploy.
- onb-15 and onb-20 browser specs were not run here (no app server).

## Known gaps (follow-ups)
- Two defences guard an expired proposal (early check and the claim); the tests fail only when both are gone.
- Two proposals made at the same moment for one document are not guarded.
- Wrong-key calls read the secret once each (no throttle).
