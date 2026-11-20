import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attributes, blocks, stripComments, type Block } from '../infra-harness';
import { STACKS, filesOf, localsOf, policyLines, resourcesOf, settingsOf, squash, valueOf, type Stack } from '../mod-01/iam';
import { kmsLists } from '../onb-21/terraform';
import { REPO } from './lambda-harness';

/**
 * CHAT-15: both Terraform stacks read as text (there is no Terraform here; the PR's required Terraform check runs the real plan on
 * pepla-dev). The new Lambda, its role, its rule: found by what they are (function name, role name), not by the label the builder chose.
 * Helpers over ../mod-01/iam.ts, which resolves string locals and reads a role policy as "Effect action resource condition" lines.
 */
export { STACKS, kmsLists, squash, valueOf };
export type { Block, Stack };

export const TF: Stack = 'talent-flow-infra';
export const FUNCTION_NAME = 'deleteLeaverChats';
export const ROLE_NAME = 'talent-flow-role-deleteLeaverChats';
export const RULE_NAME = 'delete-leaver-chats';
export const ROLE_ARN = 'arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-deleteLeaverChats';
export const BASELINE = join(__dirname, 'baseline');
export const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
export const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export const unquote = (s: string | undefined) => (s ?? '').replace(/^"|"$/g, '');

const L = () => localsOf(TF);
/** `${local.x}` replaced where x is a plain string local; the pool id (a variable) is named <POOL>. */
export function resolve(text: string): string {
  const locals = L();
  return text
    .replace(/\$\{local\.(\w+)\}/g, (m, k) => (k === 'tf_naleko_pool_id' ? '<POOL>' : (locals[k] ?? m)))
    .replace(/\$\{var\.naleko_pool_id\}/g, '<POOL>');
}

/** The shared KMS actions of talent-flow-iam.tf (`tf_kms_actions`). */
export function kmsActions(): string[] {
  const m = /tf_kms_actions\s*=\s*\[([^\]]*)\]/.exec(stripComments(read('talent-flow-infra/talent-flow-iam.tf')));
  return [...(m?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

export function lambdaBlocks(): Block[] {
  return STACKS.flatMap((stack) => resourcesOf(stack, 'aws_lambda_function').filter((b) => valueOf(stack, attributes(b.body).get('function_name')) === FUNCTION_NAME));
}
export const lambdaBlock = (): Block => {
  const found = resourcesOf(TF, 'aws_lambda_function').filter((b) => valueOf(TF, attributes(b.body).get('function_name')) === FUNCTION_NAME);
  if (found.length !== 1) throw new Error(`one aws_lambda_function named "${FUNCTION_NAME}" in talent-flow-infra/*.tf (found ${found.length})`);
  return found[0]!;
};
export const lambdaLabel = () => lambdaBlock().labels[1]!;
export function roleBlocks(): { stack: Stack; block: Block }[] {
  return STACKS.flatMap((stack) => resourcesOf(stack, 'aws_iam_role').filter((b) => valueOf(stack, attributes(b.body).get('name')) === ROLE_NAME).map((block) => ({ stack, block })));
}
export function roleBlock(): Block {
  const found = roleBlocks().filter((r) => r.stack === TF);
  if (found.length !== 1) throw new Error(`one aws_iam_role named "${ROLE_NAME}" in talent-flow-infra/*.tf (found ${found.length})`);
  return found[0]!.block;
}
export const roleLabel = () => roleBlock().labels[1]!;

/** Every policy line of a role, locals resolved, the shared KMS list written out action by action. Sorted, no duplicates. */
export function linesOfRole(label: string): string[] {
  const kms = kmsActions();
  const out = new Set<string>();
  for (const p of Object.values(policyLines()).filter((x) => x.role === label && x.stack === TF)) {
    if (p.squash !== undefined) { out.add(`UNREADABLE ${resolve(p.squash)}`); continue; }
    for (const line of p.pairs ?? []) {
      const m = /^(\w+) (\S+) (.*?) (null|\{.*\})$/.exec(line);
      if (!m) { out.add(resolve(line)); continue; }
      const [, effect, action, res, cond] = m;
      const actions = action === 'local.tf_kms_actions' ? kms : [action!];
      for (const a of actions) out.add(`${effect} ${a} ${resolve(res!)} ${cond}`);
    }
  }
  return [...out].sort();
}

/** All aws_iam_role_policy, aws_iam_policy and attachment resources that name this role. */
export function policyResourcesOf(label: string): { type: string; name: string }[] {
  const mine = new RegExp(`aws_iam_role\\.${label}\\b`);
  const out: { type: string; name: string }[] = [];
  for (const stack of STACKS) {
    for (const type of ['aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'aws_iam_policy_attachment', 'aws_iam_role_policies_exclusive', 'aws_iam_policy']) {
      for (const b of resourcesOf(stack, type)) {
        if (mine.test(b.raw) || (type === 'aws_iam_policy' && b.raw.includes(FUNCTION_NAME))) out.push({ type, name: `${stack}/${b.labels[1]}` });
      }
    }
  }
  return out;
}

/** The function's settings: name -> value text (whitespace out). */
export const settings = () => settingsOf(lambdaBlock());

/** Every resource address (type.label) of a stack. */
export const addresses = (stack: Stack) => blocks(filesOf(stack), 'resource').map((b) => `${stack}/${b.labels[0]}.${b.labels[1]}`).sort();
export const allAddresses = () => STACKS.flatMap(addresses);

/** The squashed text of one resource, hashed. */
export function resourceHash(stack: Stack, type: string, label: string): string {
  const b = resourcesOf(stack, type).find((x) => x.labels[1] === label);
  return b ? sha(squash(b.raw)) : 'missing';
}

/** Every file under lambda/<name>/ (no node_modules), by relative path, hashed. */
export function dirHashes(rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const f of readdirSync(join(REPO, d), { withFileTypes: true })) {
      if (f.name === 'node_modules') continue;
      if (f.isDirectory()) walk(`${d}/${f.name}`);
      else out[`${d}/${f.name}`] = sha(readFileSync(join(REPO, d, f.name)));
    }
  };
  walk(rel);
  return out;
}

export const kmsListSnapshot = () => kmsLists();
