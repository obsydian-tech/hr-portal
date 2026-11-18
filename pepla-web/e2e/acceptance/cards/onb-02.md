# ONB-02

Card: ONB-02 HR home: who is starting (NH-155)

Test files: `onb-02.spec.ts`

Spec: [NH-155](https://obsydian.atlassian.net/browse/NH-155)

Locks: acceptance-lock/onb-02, acceptance-lock/onb-02.1 (ONB-10's commit, below)

## Re-locked by ONB-10

`onb-02.spec.ts` changes in one place, for ONB-10: the Step cell's text is now "the step word, then an optional second line"
(a person whose documents are late gets "Overdue by 2 days" under it). `readRows` takes `step` from the cell's first line and
adds `stepNote` for the rest, and AC-2 also asserts the note is empty for its made-up people. This is what keeps AC-1's
pepla-dev check (Pieter van Wyk is seeded overdue) and AC-2 green. `support/employees-fake.ts` gains an optional
`documents_due`, carried only when a test gives it. Nothing else changes. Locks: acceptance-lock/onb-02.1 (the same commit as ONB-10's).
