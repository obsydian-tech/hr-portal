import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributes, blocks, type Block } from '../infra-harness';
import { STACKS, filesOf, resourcesOf, settingsOf, type Stack } from '../rec-02/iam';
import { dirHashes, resourceHash, sha } from '../chat-15/terraform';
import { squash } from '../onb-15/tf-policy';
import { REPO } from './lambda-harness';

/**
 * REC-16: both Terraform stacks read as text (there is no Terraform here; the PR's required Terraform check runs the real plan), and
 * the develop 9252f33 snapshot of what this card must leave exactly as it is (baseline-9252f33.json, made by snapshot() below on a
 * clean checkout of 9252f33).
 */
export { STACKS, filesOf, resourcesOf, settingsOf, squash, sha, dirHashes };
export type { Block, Stack };
export const LABEL = 'notify_hiring_manager_on_hire';
export const FUNCTION_NAME = 'notifyHiringManagerOnHire';
export const RULE_NAME = 'talent-flow-candidate-hired-notify-hm-it';
export const NEW_FILE = 'infra/rec16-hm-it-email.tf';
export const BASELINE = join(__dirname, 'baseline-9252f33.json');
export const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
export const fileHash = (rel: string) => (existsSync(join(REPO, rel)) ? sha(readFileSync(join(REPO, rel))) : 'missing');

/** The old OfferAccepted path (AC-8, rule 10): its rules, targets and permissions, by stack, type and label. */
export const OLD_PATH: [Stack, string, string][] = [
  ['infra', 'aws_cloudwatch_event_rule', 'offer_accepted_notify_hm_provisioning'],
  ['infra', 'aws_cloudwatch_event_target', 'offer_accepted_notify_hm_provisioning'],
  ['infra', 'aws_lambda_permission', 'send_notification_email_offer_accepted_provisioning'],
  ['infra', 'aws_cloudwatch_event_rule', 'offer_accepted_notify_hm_tf_bus'],
  ['infra', 'aws_cloudwatch_event_target', 'offer_accepted_notify_hm_tf_bus'],
  ['infra', 'aws_lambda_permission', 'send_notification_email_offer_accepted_tf_bus'],
  ['infra', 'aws_lambda_function', 'send_notification_email'],
  ['infra', 'aws_iam_role', 'send_notification_email'],
  ['infra', 'aws_iam_role_policy', 'send_notification_email'],
];
/** Code this card never changes (AC-6 c, AC-8, AC-10). */
export const FROZEN_FILES = ['lambda/manageOffers/index.mjs', 'lambda/shared/recruitment-actions/offers.mjs', 'lambda/shared/employee-row.mjs', 'infra/kms.tf', 'lambda/shared/hiring-managers.mjs', 'lambda/shared/tenant.mjs', 'lambda/shared/ai-guard.mjs'];
export const FROZEN_DIRS = ['lambda/advanceOfferState', 'lambda/sendNotificationEmail'];

export type Snapshot = { blocks: Record<string, string>; files: Record<string, string>; dirs: Record<string, Record<string, string>> };
export function snapshot(): Snapshot {
  return {
    blocks: Object.fromEntries(OLD_PATH.map(([s, t, l]) => [`${s}/${t}.${l}`, resourceHash(s, t, l)])),
    files: Object.fromEntries(FROZEN_FILES.map((f) => [f, fileHash(f)])),
    dirs: Object.fromEntries(FROZEN_DIRS.map((d) => [d, dirHashes(d)])),
  };
}
export const baseline = (): Snapshot => JSON.parse(readFileSync(BASELINE, 'utf8'));

/** Every resource block in both stacks, with its stack. */
export const allResources = () => STACKS.flatMap((stack) => blocks(filesOf(stack), 'resource').map((b) => ({ stack, block: b })));
/** The blocks labelled notify_hiring_manager_on_hire, as "stack/type". */
export const rec16Blocks = () => allResources().filter((r) => r.block.labels[1] === LABEL);
export const rec16 = (type: string) => rec16Blocks().filter((r) => r.block.labels[0] === type).map((r) => r.block);
export const attr = (b: Block, name: string) => attributes(b.body).get(name);
/** A file's text with whitespace and comments squashed. */
export const squashed = (rel: string) => squash(read(rel));
