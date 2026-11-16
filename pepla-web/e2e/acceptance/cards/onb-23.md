# ONB-23

Card: ONB-23 Employees sign in on the same page (NH-189)

Test files: `onb-23.spec.ts`, and changed tests in `onb-01.spec.ts` (ONB-01 AC-4, AC-4b new, end of AC-11) and
`onb-17.spec.ts` (ONB-17 AC-8), with additive changes to `support/fixtures.ts` and `support/cognito-fake.ts`

Spec: [NH-189](https://obsydian.atlassian.net/browse/NH-189)

Locks: acceptance-lock/onb-23

One sign-in page for everyone: HR lands on HR home, an employee on `/start`, an account in neither
`hr_staff` nor `employee` is refused with "This account can't use Naleko People yet. Ask your HR team." and
keeps no session. Iggie decided this on 16 Nov 2026 and saw the changed ONB-01 and ONB-17 tests before the lock.

AC-1 to AC-6 run at 1280 and 390 wide with no backend (the AC-6 phone test at 390 only, the AC-3 source
check once, at 1280). AC-7 runs in both runs and is the pepla-dev check (desktop once there): the seeded
employee test login signs in at `/sign-in` and lands on `/start`. It is red on pepla-dev until this card is
merged and deployed. The changed ONB-01 AC-4 also runs on pepla-dev.

## Changed tests of other cards

- `onb-01.spec.ts` AC-4 used to say an employee is refused at `/sign-in` and keeps no session. It now says the
  employee signs in and lands on `/start`, and `/hr` sends them back to `/start`. The old safety moved to a new
  AC-4b for an account in neither group. AC-11 (keyboard) ends with that account and the new words instead of
  the employee and the HR-only words. Nothing else in ONB-01 changed.
- `onb-17.spec.ts` AC-8 used to say the same as the old ONB-01 AC-4. It now signs the employee in at `/sign-in`
  to `/start` and out again, then checks that an account in neither group is refused and keeps no session.
  Re-locked as `acceptance-lock/onb-17.2` at the same commit as `acceptance-lock/onb-23`.

## Shared files changed with this card

`support/fixtures.ts` gains one account, `noAccess` (Lee Ndlovu, no group), and its fixture: no-backend run
only, pepla-dev has no such login. `support/cognito-fake.ts` leaves out the `cognito:groups` claim for a person
in no group, as Cognito does. No existing account is in no group, so nothing the earlier cards rely on behaves
differently.
