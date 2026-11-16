# ONB-18

Card: ONB-18 Resend the link (NH-172, epic NH-150; follows ONB-04 / NH-170 and ONB-04.2 / NH-191)

Test files: `onb-18.spec.ts` and `support/onb-18/`

Spec: [NH-172](https://obsydian.atlassian.net/browse/NH-172)

Locks: acceptance-lock/onb-18

HR opens an Invited person's page and sees the invite link (sent, to which address, when it expires) with
**Resend link**, which closes the old link and emails a new one. Two new HR-only routes on the employees API:
`GET /v1/employees/{id}/invite` (`lambda/getInvite`) and `POST /v1/employees/{id}/invite` (`lambda/resendInvite`).
A disabled sign-in is refused everywhere `signInState` is used (security review L-1). The email builders move to
`lambda/shared/invite-email.mjs`.

Lambda tests run the real handlers, each in a fresh Node process, against `support/onb-18/fake-aws`: a copy of
ONB-04.2's fake AWS with one addition, `world.postmarkFail` (every Postmark send throws). A pool user's
`enabled: false` is Cognito's `Enabled`. `support/onb-18/lambda-harness.ts` re-exports ONB-04.2's harness, points
`runModule` at this fake and adds the two routes and `inviteEmail()`. They run once, in `desktop-1280`.

Screen tests run at 1280 and 390 on the employee page with the document fake (`support/documents-fake.ts`) and
`support/onb-18/invite-fake.ts`, which answers only `/v1/employees/<id>/invite` on the employees API host.

Every word the page shows is in the `WORDS` block at the top of `onb-18.spec.ts`. Iggie approved four of them on
16 Nov 2026 ("Link expired"; no "Not opened yet" row; "sets their own password"; "The welcome email was not
sent." for every resend that does not go out).

Expected red before the build: every test. AC-12 runs on pepla-dev only and stays red until the merge deploys.
AC-14 (company check) is not written: it comes as a re-lock `acceptance-lock/onb-18.1` only if TEN-01 merges
before the builder starts.

No locked test of another card changes under this lock.
