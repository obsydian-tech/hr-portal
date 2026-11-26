/**
 * Child lock rec-06.2.1 (REC-06.2, NH-285): what REC-06.2 adds that older locked tests pinned.
 *
 * REC-06.2 gives the existing resendInvite role (infra/resend_invite) one more statement, so a person hired through Recruitment gets the
 * onboarding workflow started when HR sends the invite: Allow states:StartExecution on the onboarding state machine's own ARN, no
 * condition. The IAM checks of onb-18 AC-11, ten-02 AC-13, int-01 AC-16, int-01f AC-8, mod-01 AC-8, rec-02 AC-11, rec-04 AC-8,
 * rec-07 AC-9, rec-15, rec-15b, rec-15c and rec-15d AC-17 and ten-03 AC-10 each refuse any new grant on that role, so each leaves out
 * exactly this one line on exactly this one role, by its exact text, and nothing else. rec-06.2.spec.ts AC-8 judges the statement
 * itself (one action, the state machine's ARN, no wildcard, nothing else on the role changes).
 */
export const REC062_LINE = 'Allow states:StartExecution aws_sfn_state_machine.onboarding.arn null';
/** True only for REC-06.2's one line on resendInvite's role, by its exact text. `key` is "<stack>/<label>" as the IAM readers write it. */
export const isRec062Grant = (line: string, key: string) => /(^|\/)resend_invite$/.test(key) && line === REC062_LINE;
/** The same, for onb-18's reader, which holds action and resource apart. */
export const isRec062Row = (fn: string, action: string, resource: string) =>
  fn === 'resendInvite' && action === 'states:StartExecution' && resource === 'aws_sfn_state_machine.onboarding.arn';
