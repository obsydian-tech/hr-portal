# REC-15 step A: the candidate lists, from one stage clock (tests)

Spec: /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 1 (rules 1 to 11), rules 29 and 30 for the list, AC-1 to AC-6, the list half
of AC-16 and step A's lines of AC-17. Review page: onboarding-cards/specs/REC-15-step-A-tests-for-review.md.
Tests: pepla-web/e2e/acceptance/rec-15.spec.ts, support/rec-15/.

## Locks

- `acceptance-lock/rec-15`: rec-15.spec.ts, support/rec-15 and this file (step A only). Steps B (add a candidate), C (the record) and
  D (interviews and names) get their own tests later as rec-15.2 and on.
- `acceptance-lock/rec-04.3` (child lock): older locked tests make room for the one list and the one clock:
  - support/rec-04/roles.ts: REC-04's open candidates carry a stage time that gives the status their stored slaStatus names, at the real
    time of the run (the clock now reads the stage time, not slaStatus).
  - rec-04 AC-6: a Hired row's sla_status is null (rule 1: no clock on Hired).
  - rec-04 AC-8, rec-01 AC-8, mod-01 AC-8, ten-03 AC-10: getCandidates may gain exactly one line, a Query on talent-flow-config's
    GSI1-active-configs index.
  - rec-01 AC-3: rule 3 retires old stage names and `hiringManagerId` as query values, so the manager's search line sends only `search`,
    and a Recruiter's old `hiringManagerId` is ignored (every candidate) instead of obeyed. This line fails on today's develop on purpose.
- The builder merges both lock branches, never copies them.

## Decisions the tests pin where the spec is silent (D-T-A1 to D-T-A15, for the BA to confirm)

See the header of rec-15.spec.ts. The ones a builder is most likely to trip on:
- D-T-A1 no SLA_THRESHOLDS setting: due_at null and ON_TRACK; the monitor's built-in fallback hours are not copied.
- D-T-A2 a failed read of the settings is a 500, never a list worked out without the hours.
- D-T-A5 unknown query names are ignored, never refused; an empty `role_id` is all roles.
- D-T-A8 the token: any text the server can read back, holding no company id or table key; the old route's DynamoDB key token is 400.
- D-T-A9 a manager who hires for nobody gets 200 and an empty list. Spec AC-6 says "another manager ... 403"; REC-01 lets every manager in.
- D-T-A12 rule 31's harness half waits for REC-UI-02: the board's fake gives interviews_done, interviews_required, offer_state and pending,
  which CandidateRow does not have.

## Must be settled before REC-UI-02's tests are written (lock check round 1)

- The board's four extra list fields: `interviews_done`, `interviews_required`, `offer_state` and `pending`. The merged board reads them from
  list rows; CandidateRow is closed and has none of them. Either CandidateRow gains them (then a child lock on rec-15: the exact-key checks
  in `rowIsRight` and AC-16) or the board stops reading them from the list.
- The "must confirm before this is final" state (and its Cancel action), which the board takes from `pending` on a list row: where it comes
  from once the list is CandidateRow only.
- D-T-A9 taken on the recommended option: a manager who hires for nobody gets 200 and an empty list. The spec's AC-6 wording ("another
  manager ... 403") is to be corrected by the BA; it does not change these tests.

## Notes for the builder

- The throwaway build that passes every test is in /mnt/project-files/onboarding-cards/rec-15/throwaway-build-A.patch. A guide, not the answer.
- REC-04's role counts (GET /v1/roles, GET /v1/roles/{id}) read the same clock (rule 11). closeRole's open count does not need it.
- Run `npm run api:types` in pepla-web after the openapi change.
- rec-14.3's screen tests and ten-02 AC-12 already fail on develop 1043aa9 with no app running (E2E_BASE_URL=http://localhost:1); not this card.
