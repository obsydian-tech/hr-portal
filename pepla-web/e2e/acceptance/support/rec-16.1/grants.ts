/**
 * Child lock rec-16.1 (REC-16, NH-283): what REC-16 adds that older locked tests pinned.
 *
 * REC-16 adds one Lambda in infra/, notifyHiringManagerOnHire, with its own role and one inline policy, both labelled
 * notify_hiring_manager_on_hire (infra/rec16-hm-it-email.tf). The IAM checks of int-01 AC-16, mod-01 AC-8, rec-02 AC-11, rec-04 AC-8,
 * rec-07 AC-9, rec-15 AC-17, rec-15b AC-17, rec-15c AC-17, rec-15d AC-17, ten-02 AC-13 and ten-03 AC-10 refuse any new role or policy,
 * so each leaves out exactly that one role and policy, by its exact key, and nothing else. rec-16.spec.ts AC-10 judges them line by
 * line (the spec's IAM table, the LeadingKeys condition on writes, kms:ViaService on the PII key, no wildcard, no delete).
 *
 * ten-02 AC-13 also wants every reader of the PII-encrypted tenants table on kms_pii's dynamodb_read_role_arns. REC-16's spec keeps
 * infra/kms.tf unchanged (its lists are pinned by rec-05-kms AC-4 and onb-22) and reads the key through the role's own IAM statement,
 * which the key policy allows because it gives the account root kms:* (infra/modules/kms/main.tf). That statement carries
 * kms:ViaService = dynamodb.af-south-1.amazonaws.com, checked in rec-16.spec.ts AC-10. So ten-02 lets this one role read the key that way.
 */
export const REC16_LABEL = 'notify_hiring_manager_on_hire';
/** The policy and role key as the IAM readers write them: "<stack>/<label>". */
export const REC16_ROLE_KEY = `infra/${REC16_LABEL}`;
/** True only for REC-16's own role or policy in infra/, by its exact key. A second policy on the same role under another label is not
 * let in (the role argument is accepted for the callers' shape and ignored on purpose). */
export const isRec16Role = (key: string, _role?: string) => key === REC16_ROLE_KEY;
