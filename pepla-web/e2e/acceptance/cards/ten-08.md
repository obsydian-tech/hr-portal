# TEN-08

Card: TEN-08 The old portal signs in with email only (NH-200)

Test files: `ten-08.spec.ts` and `support/ten-08/`

Spec: [NH-200](https://obsydian.atlassian.net/browse/NH-200)

Locks: acceptance-lock/ten-08

The old portal (`hr-portal/`) has no acceptance set-up of its own. `support/ten-08/old-app.ts` runs its real
`AuthService` and `LoginComponent` in Node: files under `hr-portal/src` are transpiled with pepla-web's
TypeScript as they are, Angular, PrimeNG and `amazon-cognito-identity-js` are small stand-ins, and rxjs is the
real one from pepla-web. The stand-in Cognito records who it is asked to sign in and answers as the test says.
Every HTTP call (HttpClient, fetch, XMLHttpRequest) is recorded and refused. A package with no stand-in stops
the test and names it. No browser, no AWS, no AI. The tests run once, in `desktop-1280`. Nothing runs on
pepla-dev.

AC-3 reads `login.component.html` and `auth.service.ts` as text.

Expected red before the build: AC-2 and AC-3. AC-1 passes on develop already: an email is trimmed and sent
today, and the card keeps that.
