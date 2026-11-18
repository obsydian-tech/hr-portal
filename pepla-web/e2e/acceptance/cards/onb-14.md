# ONB-14

Card: ONB-14 Every Show is logged (NH-182). RED: the extra Opus review is `ONB-14-security-review.md`; its conditions C-1 to C-4 and S-1 to S-3 are carried by the tests.

Test files: `onb-14.spec.ts`, `support/onb-14/`, and the changes to `onb-12.spec.ts` (AC-2, AC-11), `onb-15.spec.ts` (AC-6, AC-12), `be-18.spec.ts` (AC-4), `mod-01.spec.ts` (AC-8), `ten-03.spec.ts` (AC-10), `onb-11.spec.ts` (AC-10), `onb-20.spec.ts` (AC-8), `ten-04.spec.ts` (AC-5), `support/documents-fake.ts`, `support/onb-15/document-fake.ts`, `support/help-02.ts` and `support/help-03.ts`.

Spec: [NH-182](https://obsydian.atlassian.net/browse/NH-182)

Locks: acceptance-lock/onb-14, with child locks for every changed locked spec: onb-12, onb-15, onb-11, onb-20, mod-01, ten-04, be-18, help-02 and help-03 (final names, free on the remote 18 Nov 21:00 SAST: onb-14, onb-12.5, onb-15.4, onb-11.4, onb-20.1, mod-01.7, ten-03.7, ten-04.6, be-18.3, help-02.6, help-03.2).

## What the tests run

- **Lambda tests** (AC-1 to AC-4, AC-8): the real `lambda/revealDocumentField`, `getSingleDocumentVerification`, `getEmployeeDocumentVerifications` and `auditLogConsumer`, each in a fresh Node process, against a fake AWS (`support/onb-14/fake-aws`, from ONB-15's). DynamoDB honours writes and conditions; KMS decrypts "kms:" ciphertext and can refuse; **EventBridge records every entry in call order and fails the ways the real one does** (the call throws, `FailedEntryCount` 1 with and without an error code, `Entries[0].ErrorCode` only, never answers); every call, log line and the moment the handler returned are recorded in order. An AI client import fails the run. Two sets of tables: company rows, and company A's rows with no `tenant_id` (how prod holds them today: the legacy company). Nothing reaches AWS.
- **Text checks** (AC-4, AC-8, AC-9, S-2, S-3): `infra/*.tf`, `api/openapi.yaml` (python3 and PyYAML), `api/agent-tools.json`, `lambda/` and `scripts/ci/seed-dev.py` are read as text. The Lambda, its role and its policy are found by name (`revealDocumentField`, the `role` line, the policy's `role` line), not by a resource name the card did not give.
- **Screen tests** (AC-4 screen, AC-5, AC-6, AC-7, AC-10, AC-11) at 1280 and 390 wide with no backend: `support/documents-fake.ts` and `support/onb-15/document-fake.ts` answer without the full numbers (last four and two flags) and one `RevealFake` (`support/onb-14/reveal-fake.ts`) answers `POST /v1/verifications/<id>/reveal` for both pages, records every call with its headers and body, and can hold, fail (500, 403, 404, offline), answer slowly or answer another value. Cognito is the shared fake; AI routes are blocked.
- **AC-12 on pepla-dev**, desktop only, once: HR presses Show on Naledi's ID, then the agent API's `GET /agent/v1/audit-log?employeeId=` holds the new event. Expected red until the card is merged and applied.

## Which assertions are new

Everything in `onb-14.spec.ts`. Of it, these already hold on develop and are not what makes the test red: the 403 for the employee who owns a document on `GET /v1/verifications/<id>` (ONB-15), and the people-who-are-not-HR rules of the group helpers. Everything else fails on develop (there is no route, the numbers are in both answers, the pages have no line).

## Changes to locked tests

| Locked check | Becomes |
|---|---|
| `onb-12.spec.ts` AC-2: the page says nothing about recording (`recorded`, `logged`) | The page says "Showing this is recorded" beside Show (described by it), never "Revealing is recorded" or "logged"; after Show it says "Shown to you, <date time>. Hides again in 2 minutes." |
| `onb-12.spec.ts` AC-11: "HR still gets the full ID number" | The answer has no `id_number`; it has `id_number_last4` and `id_number_available`; the full number is nowhere in the answer |
| `onb-15.spec.ts` AC-6: the page does not say showing is recorded | The page says "Showing this is recorded" beside each Show, and "Shown to you, ..." after it; the Lambda part: no `id_number` in the GET, `id_number_available` true for an encrypted and a legacy plain row |
| `onb-15.spec.ts` AC-12: `extracted_data` holds `id_number` and `account_number`; the OpenAPI lists them | `extracted_data` holds `id_number_last4`, `account_number_last4`, `id_number_available`, `account_number_available`; no full number anywhere in the answer; the OpenAPI lists those and no longer lists `id_number` or `account_number` |
| `be-18.spec.ts` AC-4 (two places): the own list tries to decrypt and logs the KMS error name | The own list asks KMS for nothing (the full number is no longer in it); still no error text in the log |
| `mod-01.spec.ts` AC-8: any new role policy must be a gated Lambda's | The role of `reveal_document_field` is skipped (judged in `onb-14.spec.ts` AC-9) |
| `ten-03.spec.ts` AC-10: any new role policy belongs to the pre-token trigger | The role of `reveal_document_field` is skipped (judged in `onb-14.spec.ts` AC-9) |
| `onb-11.spec.ts` AC-10 (on top of onb-11.3), `onb-20.spec.ts` AC-8: the verification routes are pinned | The one new route `POST /v1/verifications/{id}/reveal` is allowed |
| `ten-04.spec.ts` AC-5: earlier operations add-only | The GET of one verification may lose its description and the `id_number` and `account_number` properties; nothing else may change |
| `support/help-02.ts`, `support/help-03.ts` (fakes) | Their HR answers send `id_number_last4` and `id_number_available`, as the API does now |
| `support/documents-fake.ts`, `support/onb-15/document-fake.ts` | The fakes answer without the full numbers and gain the reveal fake (add-only apart from the answer). Each fake exposes `revealLookup`, which the shared reveal fake in `onb-14.spec.ts` uses |

`infra/kms.tf` and `modules/kms` stay untouched (C-2): the new role is in no `kms_pii` list. `be-18.spec.ts` changes only for the own list (above).

## Locked tests the verifier checked for the new Lambda and the two edited handlers

Run on the throwaway correct build (`ONB-14-throwaway.patch.txt`, not committed): `onb-14`, `onb-12`, `onb-15`, `onb-08`, `onb-11`, `onb-13`, `onb-20`, `be-17`, `be-18`, `be-20`, `ten-01`, `ten-02`, `ten-04`, `mod-01`, `ops-05`, `help-02`, `help-03`, `onb-06`. All pass except `ten-02` AC-12, which needs `jest` in `lambda/shared` (not installed here; it does not touch this card). See the review page.

## `lambda/` grep for the two numbers (AC-4's list)

Files that name `id_number`, `account_number`, `idNumber` or `accountNumber`: `createEmployee` (registration input), `getEmployeeDocumentVerifications`, `getSingleDocumentVerification` (both: last four and flags only after this card), `processDocumentOCR` (writes the row), `revealDocumentField` (the new route), `shared/document-check.mjs` (the check and the comparison words), `shared/employee-input.mjs` (registration input). `summariseVerification` no longer names either number (PII-01 removed it). `getEmployees` returns only `id_number_last4`. The test lists the files exactly: a new file that names either number fails it until it is looked at.
