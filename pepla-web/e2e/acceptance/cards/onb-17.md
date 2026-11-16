# ONB-17

Card: ONB-17 Set your password, and an expired link (NH-171)

Test files: `onb-17.spec.ts`, `support/onb-17/`, and the shared `support/cognito-fake.ts` (additive change, see below)

Spec: [NH-171](https://obsydian.atlassian.net/browse/NH-171)

Locks: acceptance-lock/onb-17, acceptance-lock/onb-17.2

AC-1 to AC-10 run at 1280 and 390 wide with no backend (AC-10, the phone criterion, at 390 only).
`support/onb-17/invite-fake.ts` answers `POST <employeesApiUrl>/v1/invites/lookup` and
`POST <employeesApiUrl>/v1/invites/redeem` exactly as the ONB-04 spec (NH-170) fixes them: the fields,
the status codes and the rule names `minLength`, `maxLength`, `lower`, `upper`, `number`, `symbol`. It
records every call with its body, all its headers and the page's address when the call went out, and
every preflight. A good redeem tells the Cognito fake the person's password is set; a failed password
does not use up the link. Cognito is the shared fake.

AC-11 runs on pepla-dev (desktop only, once): the HR test login registers an
`e2e.run-<id>@blackhole.postmarkapp.com` address through the real `POST /v1/employees` and takes
`invite.link` from the answer (ONB-04 AC-5), opens it in the app, sets a password, lands on `/start`, and
finds the same link expired the second time. It is skipped in the no-backend run, and red until ONB-04
and this card are both merged and deployed to pepla-dev. The dev cleanup removes the person.

AC-12 reads files as text and runs `scripts/verify-design.mjs` (once, in `desktop-1280`). The card's own
files are the files under `pepla-web/src` that are not in `support/onb-17/src-files.ae7bba4.txt` (the list
at ae7bba4) and that call `/v1/invites/` or carry the page's words.

## Shared file changed with this card

`support/cognito-fake.ts` gains three methods, additively only: `addAccount` (a person who joins during
the run, in the first-password state), `setPassword` (what `AdminSetUserPassword` with `Permanent` does,
called by the invite fake) and `subOf` (an account's Cognito id). Nothing the earlier cards rely on
behaves differently.

## Later cards

AC-8 was changed by ONB-23 (NH-189, Iggie's decision of 16 Nov 2026: one sign-in page for everyone) and
re-locked as `acceptance-lock/onb-17.2`. It used to check that an employee at `/sign-in` is refused; it now
checks that the employee signs in there and lands on `/start`, and that an account in neither group is
refused and keeps no session. See `cards/onb-23.md`.

ONB-05 replaces the `/start` holding page. AC-4, AC-6, AC-7, AC-9 and AC-10 look for the heading
"Welcome, <given name>" there, AC-7, AC-9 and AC-10 for its "Sign out" button, and AC-4 and AC-10 for
the line "Your password is set. Your onboarding steps will show here." If ONB-05 changes any of these, it
needs a re-lock of this card (`acceptance-lock/onb-17.2`), with the diff shown to Iggie.
