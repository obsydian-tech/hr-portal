# REC-UI-04.2

Card: REC-UI-04 step A.2 (NH-230, epic NH-223, red): the real offer walk on pepla-dev, and three small fixes to the offer page
from the step A build review (N-1, N-2, N-5). Child lock of REC-UI-04 step A.

Test file: `rec-ui-04.2.spec.ts`, with `support/rec-ui-04/dev-ids.json`. It reads `support/rec-ui-04/offers-fake.ts` and `kit.ts`,
`support/rec-ui/harness.ts`, `support/mod-02/shell-snapshot.ts`, `support/sign-in-again.ts` and `support/rec-05/dev-ids.json`, and
changes none of them. `rec-ui-04.spec.ts` (locked) does not change.

Spec: `onboarding-cards/specs/REC-UI-04.2.md` (AC-14.1 to AC-14.6), checked in `REC-UI-04.2-spec-check.md` (rounds 1 and 2);
decisions D-RUI-04.2a to f. The parent `REC-UI-04.md` wins where this card is silent.

Locks: acceptance-lock/rec-ui-04.2. Build branch: `fix/rec-ui-04-a2`. The build changes `pepla-web/src/app/features/recruitment/offer.page.ts`
(and `offer-words.ts` if the lines move there) only.

## What runs where

- AC-14.3, AC-14.4, AC-14.5: the no-backend run, at 1280 and 390, against the step A fake. Red on develop before the build.
- AC-14.1, AC-14.2: pepla-dev only (`@pepla-dev`), once, at 1280, in the main acceptance run (not the company walk step). They skip
  in the no-backend run. Judged after merge.
- AC-14.6: the locked `rec-ui-04`, `rec-ui-01`, `rec-ui-02*` and `mod-02` files pass on the build, unchanged. No test of its own.

## REC-UI-04.2 dev seed

`scripts/ci/seed-dev.py` gets `seed_recui04(ddb, tenant_id)`, called from `main()` for company A, add-only, written in the same commit
as these tests. The ids are in `support/rec-ui-04/dev-ids.json`. On every run it:

- writes the candidate `CAND-RECUI04DEVWALK000000000001` ("Rec Seed-OfferWalk", a name no other seed uses) in Offer, company A, no
  `role_id` (M-1: reset-dev-rec04.py clears candidates on the REC-04 roles), `hiringManagerId` = `OTHER_HIRING_MANAGER`, the seed tag,
  the same SAGA shape as the REC-05 seed rows;
- deletes its live-offer lock row, so a run that stopped before its withdraw does not leave every later run on 409 OFFER_EXISTS;
- deletes every offer row of this candidate in company A (S-1), so the Offers list does not grow by a row per run.

It finds the old offer rows with a filtered Scan (`begins_with(PK, "OFFER#")`, `candidate_id`, `tenant_id`) and filters the answer
again in code, instead of the GSI2 index the spec names: the seed-run fakes of the locked rec-04 and rec-14 tests raise on any index
read, so a GSI2 query would break them. It is not on `reset-dev-rec04.py`'s list. INT-01 (NH-269) also adds to `seed-dev.py`: whichever
merges second rebases and keeps both functions.

## Choices the tests take (D-T-04.2.x)

- D-T-04.2.1 The pepla-dev approver login (`approver` in seed-dev.py) holds only `perm-approve-offers`, no role. The app has no first
  page for a person with no role: after sign-in it tries /start, which sends a person with no role back to /sign-in. AC-14.1 therefore
  waits for the sign-in to finish (a token in storage), opens /hire/offers by address only if no shell is on screen, and then opens
  Offers from the sidebar. The Offers entry must be in the approver's sidebar. A first page for approver-only people is not in this card
  (follow-up for the BA).
- D-T-04.2.2 AC-14.2 uses REC-05's seeded draft (`draftOffer` in `support/rec-05/dev-ids.json`) as company A's offer address, so it does
  not depend on AC-14.1 (spec check round 2 note). It first opens the address as company A, so B's "not found" cannot come from an
  address that does not exist.
- D-T-04.2.3 Whether company B has Recruitment is read from B's own sidebar at run time, as REC-UI-02 record AC-R15 does (spec check round 2
  note). The test looks for the Offers entry rather than Candidates: Offers is the entry whose guard decides this page, and a B person
  with only the approver tick would see Offers but not Candidates.
- D-T-04.2.4 The preflight is checked from both the dev site's address and the address under test (the main run serves the app at
  127.0.0.1:4300), as real requests with `page.request`, the same way REC-05 AC-11 and REC-UI-02 AC-17 do. `talent-flow-infra/locals.tf`
  allows both origins on dev.
- D-T-04.2.5 State word and date are asserted as the locked AC-6 and AC-8 do: the lozenge word, then the first dt/dd fact
  (`Approved` / `Sent` / `Withdrawn`, then the date). The date must be today in Johannesburg, read before and after the walk.
- D-T-04.2.6 Role and Department are not checked in the walk: the seed candidate has no role, so the offer stores them as null (M-1).
- D-T-04.2.7 AC-14.3 is judged for the approver with the tick only, for HR with the approver tick and no Recruitment tick, and for the
  approver told `drafted_by_me: true`; the guard on the fix is a person with both ticks told `drafted_by_me: false` who still gets the form.
  The read-only Draft must hold the parts every other state has (S-2): the Draft lozenge, the sent-back message, Offer details (Role,
  Department, Salary hidden, Start date, Benefits, kit order) and Approval chain ("Not approved yet."), in that order after the person
  header, with the waiting-for-approval kit accordion's classes and only design system classes. It names no new words.
- D-T-04.2.8 AC-14.4: "once" is counted on the whole page (a dialog or drawer included). Withdraw is judged on a Waiting offer by a
  Recruiter who did not draft it, because that is where today's page wrongly shows the drafter line. The parent rule that a 403 on
  Send back shows the drafter line only is checked in the same test (parent AC-5 checks Approve only), so the test cannot pass on today's
  develop through its guard part alone.
- D-T-04.2.9 AC-14.5 presses every visible, enabled button inside `<main>` and then counts requests: no POST to `/v1/offers` and no write
  of any kind.

## Pinned counts (S-4)

Grep of the `@pepla-dev` tests in `rec-ui-01`, `rec-ui-02`, `rec-ui-02-add`, `rec-ui-02-record`, `rec-01` and `rec-04`, 26 Nov 2026,
develop 31d048f. What pins a count, and why one more no-role Offer candidate of the other hiring manager moves none of them:

- `rec-01` AC-9: the manager login lists exactly one candidate. The seed candidate's hiring manager is `OTHER_HIRING_MANAGER`.
- `rec-01` AC-9: the HR login's count is only "more than one" and written as a note.
- `rec-04` AC-10: Fleet controller's open count is 6 (5 after REC-UI-01 AC-13's Not hired). Per role; the seed candidate has no role.
- `rec-ui-01` AC-13: the Fleet controller board. Per role.
- `rec-ui-02` AC-15: the Candidates "All" count equals the rows on the list and the Pipeline "{n} candidates" line. One more row moves all
  three alike (REC-05's two no-role Offer seed rows already pass there).
- `rec-ui-02-add` AC-17, `rec-ui-02-record` AC-R15: by name only.

None found that this seed changes.

## Not in this lock

Step B (`rec-ui-04.1`, AC-15 to AC-19, after REC-06). N-3 (new wording) and N-4 (no offer-to-offer link yet). Phone width for the dev
walk. Any change to the offers Lambda or its routes.
