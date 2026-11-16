# ONB-17

Card: ONB-17 Set your password, and an expired link (NH-171)

Test files: `onb-17.spec.ts`, `support/onb-17/`, and the shared `support/cognito-fake.ts` (additive change, see below)

Spec: [NH-171](https://obsydian.atlassian.net/browse/NH-171)

Locks: acceptance-lock/onb-17

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

AC-8 checks that an employee who signs in at `/sign-in` is still refused and keeps no session, as ONB-01
AC-4 does. A card that lets employees sign in at `/sign-in` (Iggie's open decision) changes ONB-01 AC-4
and this test together, with re-locks of both cards.

ONB-05 replaces the `/start` holding page. AC-4, AC-6, AC-7, AC-9 and AC-10 look for the heading
"Welcome, <given name>" there, AC-7, AC-9 and AC-10 for its "Sign out" button, and AC-4 and AC-10 for
the line "Your password is set. Your onboarding steps will show here." If ONB-05 changes any of these, it
needs a re-lock of this card (`acceptance-lock/onb-17.2`), with the diff shown to Iggie.
