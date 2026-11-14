# OPS-08

Card: OPS-08 One test notes file per card (NH-161): checks the lock rule

Test files: `ops-08.spec.ts`, `support/ops-08/`

Spec: `onboarding-cards/specs/OPS-08.md`

Locks: acceptance-lock/ops-08, acceptance-lock/ops-08.2

This card moved each card's notes out of the README into `cards/<card>.md` and made the
"Acceptance tests locked" check judge a merge file by file. The tests start throwaway git
repos on the runner, run the check's own steps against them, and call nothing outside the machine.
Needs `git`, `bash` and `python3`. They run once (in `desktop-1280`).
