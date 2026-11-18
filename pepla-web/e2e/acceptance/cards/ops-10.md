# OPS-10

Card: OPS-10 App tests on dev run after the merge, not on every pull request: plays the workflow files

Test files: `ops-10.spec.ts`

Spec: /mnt/project-files/onboarding-cards/specs/OPS-10.md

Locks: acceptance-lock/ops-10

`ops-10.spec.ts` checks `.github/workflows/` rather than a page, with the helpers of
`support/ops-02-workflows.ts`. It runs once (in `desktop-1280`), opens no page and calls
nothing outside the machine. It also re-locks one test of OPS-02: `ops-02.spec.ts` AC-3
as `acceptance-lock/ops-02.4`, same commit.
