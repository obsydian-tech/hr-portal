Every Terraform IAM policy line on develop 7dcca4d (24 Nov 2026), as policyLines() in support/rec-04/iam.ts writes them. rec-15b.spec.ts
AC-17 compares today's lines with these: createCandidate may gain exactly one line (GetItem on talent-flow-roles); every other role may gain
only the REC-07 grants (support/rec-07.1/grants.ts). Test data only.
