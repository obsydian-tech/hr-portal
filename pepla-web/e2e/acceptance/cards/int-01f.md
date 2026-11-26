# INT-01.F · Interview server leftovers (NH-281, red)

Spec: `/mnt/project-files/specs/interview-journey/cards/INT-01.F.md` (rules 1 to 6, decisions INT-01F-D1 to D9), checked in
`INT-01.F-spec-check.md`. Tests: `int-01f.spec.ts`, support in `support/int-01f/` (nothing in `support/int-01/` is changed).
Lock: `acceptance-lock/int-01f`. No child lock. Built on develop 9252f33.

Run (no backend, about 3 minutes): from `pepla-web/e2e/acceptance`,
`E2E_BASE_URL=http://localhost:1 npx playwright test -c playwright.config.ts int-01f.spec.ts --project desktop-1280 --reporter=line`

## Pinned by the test writer where the spec is silent

Written out at the top of `int-01f.spec.ts`. In short:

- **F-T1** The single expired answer is `410 { error: 'Scoring link has expired' }`.
- **F-T2** Refusal bodies are today's: `403 { error: 'Forbidden' }`, `400 { error, code: 'INVALID_FIELD', field }`, `409 { error: 'Conflict', code }`.
- **F-T3** "Applied once" is judged on the row (sequence raised once, one interview, one link row).
- **F-T4** The tests leave a request key RUNNING by making `finish()`'s write (the one that stores `answer_body`) fail.
- **F-T5** No answer, event or log line names `pending_interview_id`; no log line and no take-over answer holds its value.
- **F-T6** A take-over that loses to another take-over is `409 KEY_IN_USE`.
- **F-T7** A late first request's `finish()` leaves the taker's row as the taker wrote it.
- **F-T8** A 64-character plain name still comes back in `field`.
- **F-T9** AC-4 finds the done write by the text `completed_by` in its input.
- **F-T10** An interview booked the old way gets the `attribute_not_exists(sequence)` form on the done write too.
- **F-T11** On an old-way interview, the guest vote's `attribute_not_exists(sequence)` form is judged by the write count: a first
  `sequence` written in the gap means two vote writes and one vote. A guest taken off always has the old link stopped too, so
  `expires_at` refuses that case first.

## For the builder

- Keep `answer_body` and `completed_by` as names in the key row's finished write and in the done write (the hooks find those writes by
  them).
- The booking id comes from `reserve()` (`pending_interview_id` on the RUNNING row); a take-over reuses the row's id.
- `finish()` needs the company to keep `tenant_id`; it must write only while `started_at` is still its own.
- The guest vote's retry may need a Query of the candidate's rows (submitVoteByToken already holds Query on the state table).
- Change the PanelEntry description line in both `api/openapi.yaml` and `pepla-web/src/app/core/api/openapi.d.ts` (rule 4.3); no test
  reads that line.
- AC-9 (pepla-dev) books CULTURE_FIT (or BEHAVIORAL if that is taken) on INT-01's dev candidate and cancels it. Clean-up of what it
  leaves belongs in `scripts/ci/reset-dev-rec04.py` (spec AC-9); no test reads that script.
- Strong reads (`ConsistentRead: true` on the signed-in re-read and the guest `open()` reads) cannot be proved by the fake store; the
  security review reads them.

## Left open after the lock check (round 2, frozen with the tests)

- `ConsistentRead: true` cannot be tested on the fake store: the security review reads the real build.
- The PanelEntry description line in `api/openapi.yaml` and `openapi.d.ts` is not tested.
- AC-9 runs on pepla-dev after merge only; it is the first proof on a real table. Everything else runs the real Lambda code against a
  fake table, so condition text is judged by what the fake store evaluates, not by DynamoDB itself.
- ten-02 AC-12 fails in the cloud machine on develop and on the working build alike (no jest in `lambda/shared`); not this card.
- **Guest link check (for the security review):** the guest vote never confirms that the interview still names this link
  (`guest_link_hash`). Today that is safe only because every removal or replacement also stops the old link (`expires_at`) and raises
  `sequence`. A future path that forgot to stop the link would let the old guest vote. The security review decides whether the build
  adds that check; no test requires it.
