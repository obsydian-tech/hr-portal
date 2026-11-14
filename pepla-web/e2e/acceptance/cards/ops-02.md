# OPS-02

Card: OPS-02 Dev test run starts after app-only merges (NH-152): checks the workflow files

Test files: `ops-02.spec.ts`

Spec: [OPS-02 card](https://claude.ai/artifact/RcgsQNdSreMKuSwNJp76BZ)

Locks: acceptance-lock/ops-02, acceptance-lock/ops-02.2, acceptance-lock/ops-02.3

`ops-02.spec.ts` checks `.github/workflows/` rather than a page.
`support/ops-02-workflows.ts` reads the workflows with python3 and PyYAML,
applies GitHub's path filter rules to sample file lists, and runs the real
"post results" step of `app-e2e-dev.yml` on the sample results in
`support/ops-02/` with a fake GitHub API. These tests run once (in
`desktop-1280`), open no page and call nothing outside the machine.
