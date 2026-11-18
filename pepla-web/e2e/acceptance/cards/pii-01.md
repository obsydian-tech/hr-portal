# PII-01

Card: PII-01 No ID, bank or phone number reaches the model through the document summary (red)

Test files: `pii-01.spec.ts`, `support/pii-01/`

Spec: `/mnt/project-files/onboarding-cards/specs/PII-01-bank-numbers-to-model.md` (18 Nov 2026, written against develop `c859f0f`)

Locks: acceptance-lock/pii-01

Every test runs once, in `desktop-1280` (no screen, so no phone criterion). They run the real
`lambda/summariseVerification` handler in a fresh Node process against `support/pii-01/fake-aws` (copied from
ONB-11's). The fake Bedrock records the prompt of every attempt; every console line is a recorded log line; every
outside HTTP call is recorded and refused. Nothing reaches AWS or any AI service. No test prints a number: every
check is a yes or no, and every number in the tests is made up.

Changes to the copy of ONB-11's fake:
- `world.modelFailMessage` sets the service text of a failing Bedrock call (AC-9 plants a number in it).
- `PII01_REDACTOR` (`throw`, `miss12`, `identity`, `check-throws`) swaps `lambda/shared/pii-redact.mjs` for a broken
  stand-in **inside the harness only**, to prove the handler fails closed (AC-6). The stand-ins are in
  `support/pii-01/fake-aws/redactor-*.mjs`. They are never part of a build.

## Criteria

AC-1 to AC-9 run the handler. AC-10 loads `lambda/shared/pii-redact.mjs` in a fresh process (`support/pii-01/redact-probe.mjs`)
and runs the shared `node --test` file. AC-11 reads files. **AC-12 (pepla-dev) has no automated test, on purpose:** test
logins are robots and get the stand-in, and nothing automated may call Bedrock. After the merge a person with a real login
runs the summary on dev for one document whose review notes hold a made-up number and checks the answer does not repeat it.

## What the tests pin (read before you build)

- **The rule is judged by an oracle written in the spec, not by your regex.** A run of six or more digits (any Unicode
  digit) with **up to three** separators (space, tab, line break, no-break space, dot, hyphen) between two digits. This is
  **stricter than the card's regex**: the card's single optional separator misses `Acc  6212  3456  789` (two spaces) and
  `6212\r\n3456\r\n789` (Windows line breaks). Both are tested. The card said "the builder keeps the rule or a stricter
  one; the tests decide".
- The placeholder is `[removed]` (AC-4 and AC-10 pin it, as the card does). Renaming it later is a child lock.
- `redactNumbers` must replace the whole run with `[removed]`. `hasNumberRun` must be true exactly when `redactNumbers` changes
  the text. `NUMBER_RUN` is exported and is a `RegExp`. Calls must not keep state between them (a `g` regex with `.test`).
- The fixed line for `NATIONAL_ID` and `BANK_CONFIRMATION` is `Not included for this document type.` (the prompt keeps its
  `Document type:`, `Verification status:`, `OCR confidence score:` and `Review notes:` labels, as today).
- A stored type that is not exactly one of the known words (including `NATIONAL_ID ` with a trailing space, lower case, or
  with a sentence after it) reads `OTHER` and gets the cleaned text, never the raw text and never the fixed line.
- Status: one of the four words or `PENDING` (also when missing). Confidence: a number 0 to 100, or `N/A` (`NaN`, missing,
  text, a string attribute). A real `87` stays `87`.
- Redaction runs before the 2000-character cut (AC-2: a number that starts 4 and 5 characters before the cut).
- Fail closed (AC-6): redactor throws, last check throws, redactor misses a 12-digit run, redactor does nothing: **no Bedrock
  attempt at all**, status 502, body exactly `{"error":"AI summary service unavailable — try again shortly"}`, no raw value
  in the body or any log line, at least one error log line that carries `errorName`.
- A failed model call is not tried again with the original text: every prompt of every attempt is checked (AC-1).
- Logs (AC-9): no number, no word of the notes or the text, no service message, no `.message` key, over every path.
- AC-11 keeps the Lambda's settings and the agent tool as they are (the four environment variables it has today; the
  `get_verification_summary` entry in `api/agent-tools.json` deep-equal to develop `c859f0f`). **It does not freeze all of
  `infra/`** (the card says "byte-identical"): any later card that edits `infra/` would turn a whole-folder pin red on
  develop. The frozen IAM snapshots of `ten-02` and the review checklist cover the rest.
- The new shared test file `lambda/shared/pii-redact.test.mjs` must exist, be listed in the shared `npm test` script after
  `risk-summary.test.mjs`, and pass with at least five tests.

## Expected red before the build

On develop `c859f0f` (run, 20 tests): 15 fail, which is the point (AC-1 to AC-6 and AC-9 to AC-11). Five pass today and
must keep passing: AC-2 "words and short numbers are kept, text still cut to 2000", AC-6 "a clean row reaches the model",
AC-7 "another company gets a 404" and "callers who may not use the route are refused", and AC-8 (the robot, the off switch,
the guard). They are there so the build cannot break them.

With the child lock below, `ten-04` AC-5 also turns red on develop until the build merges (its baseline expects the new
documentation sentence). That is planned.

## Locked files this card changes

One: `support/ten-04/openapi.baseline.json`, one line. The card's own doc edit (the sentence "No PII is sent to the model."
in the description of `GET /v1/verifications/{id}/summary` in `api/openapi.yaml`) turns the locked `ten-04` AC-5 red, because
that test holds every earlier operation's wording to this baseline (add-only). The baseline now carries the new sentence,
`Numbers of six or more digits are removed from the text before it is sent to the model.`, in the same place. **The build must
make exactly that one-sentence change in `api/openapi.yaml`** (replace the sentence in place, on its line, nothing else in
that description). It is a child lock of `ten-04` (`ten-04.3` in the review page), in the same one test commit.

No other locked spec reads the prompt (greps in the review page). The builder runs `be-17`, `be-17.1`, `be-18`, `be-19`,
`be-20`, `ten-01`, `ten-02`, `ten-04` and `onb-11` before the PR. `ten-02` AC-12 runs `npm test` in `lambda/shared`, so it
needs `npm ci` there first (it also runs the new `pii-redact.test.mjs`).
