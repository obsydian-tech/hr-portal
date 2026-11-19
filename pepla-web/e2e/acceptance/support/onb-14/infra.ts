import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INFRA, REPO, attributes, blocks, stripComments, tfFiles, type Block } from '../infra-harness';
import { lambdaNamed, roleResourceOf, settingsOf } from '../mod-01/iam';
import { ACCOUNT, REGION, policyOf } from '../onb-15/tf-policy';
import { statements } from '../ops-05/iam-eval';

/**
 * ONB-14: reads the new Lambda, its role, its route and its throttle from infra/*.tf as text (there is no Terraform here;
 * the PR's required Terraform check runs the real plan). Nothing is hard-coded to the builder's resource names: the
 * Lambda is found by its function name, its role by the `role` line, its policy by the policy's `role` line.
 */

export const FN = 'revealDocumentField';
export const ROUTE_KEY = 'POST /v1/verifications/{id}/reveal';
export const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
export const infraText = (file: string) => readFileSync(join(INFRA, file), 'utf8');
export const noComments = (s: string) => stripComments(s);

const strip = (v: string | undefined) => (v ?? '').replace(/^"(.*)"$/, '$1');

export function tableNameOf(resourceName: string): string {
  const b = blocks(tfFiles(), 'resource').find((x) => x.labels[0] === 'aws_dynamodb_table' && x.labels[1] === resourceName);
  return strip(attributes(b?.body ?? '').get('name')) || resourceName.replace(/_/g, '-');
}

/** A policy resource, with Terraform references to tables turned into their ARN tail ("table/documents"). */
export function norm(resource: string): string {
  return resource
    .replace(/\$\{aws_dynamodb_table\.(\w+)\.arn\}/g, (_m, n: string) => `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${tableNameOf(n)}`)
    .replace(/^aws_dynamodb_table\.(\w+)\.arn/, (_m, n: string) => `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${tableNameOf(n)}`);
}

export type Infra = {
  fn: Block;
  fnName: string;
  /** The role resource name (aws_iam_role.<role>). */
  role: string;
  /** Every Allow statement of the role's inline policies, as [action, resource] pairs, resources normalised. */
  allows: Array<[string, string]>;
  /** Every Deny statement as text. */
  denies: number;
  policies: Block[];
  attachments: Block[];
};

export function revealInfra(): { found: false; why: string } | ({ found: true } & Infra) {
  const fns = lambdaNamed(FN);
  if (fns.length !== 1) return { found: false, why: `infra declares the Lambda ${FN} ${fns.length} times (once is right)` };
  const fn = fns[0]!.block;
  const role = roleResourceOf(fn);
  if (!role) return { found: false, why: `${FN} has no role = aws_iam_role.<name>.arn` };
  const all = blocks(tfFiles(), 'resource');
  const policies = all.filter((b) => b.labels[0] === 'aws_iam_role_policy' && new RegExp(`^aws_iam_role\\.${role}\\.(name|id)$`).test(attributes(b.body).get('role') ?? ''));
  const attachments = all.filter((b) => (b.labels[0] === 'aws_iam_role_policy_attachment' || b.labels[0] === 'aws_iam_policy_attachment') && new RegExp(`aws_iam_role\\.${role}\\b`).test(b.body));
  const allows: Array<[string, string]> = [];
  let denies = 0;
  for (const p of policies) {
    const doc = policyOf({ type: p.labels[0]!, name: p.labels[1]!, raw: p.raw, body: p.body, attrs: attributes(p.body) });
    for (const s of statements(doc)) {
      if (s.Effect !== 'Allow') { denies++; continue; }
      for (const a of ([] as string[]).concat((s.Action as string | string[]) ?? [])) for (const r of ([] as string[]).concat((s.Resource as string | string[]) ?? [])) allows.push([a, norm(r)]);
    }
  }
  return { found: true, fn, fnName: FN, role, allows, denies, policies, attachments };
}

/** Which of the pairs the card's role may hold, and which it may not. */
export function unexpected(allows: Array<[string, string]>): string[] {
  const bad: string[] = [];
  for (const [a, r] of allows) {
    const ok =
      (/^logs:(CreateLogGroup|CreateLogStream|PutLogEvents)$/.test(a) && new RegExp(`^arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/lambda/${FN}(:\\*)?$`).test(r)) ||
      (/^xray:(PutTraceSegments|PutTelemetryRecords)$/.test(a) && r === '*') ||
      (a === 'dynamodb:GetItem' && [`documents`, `document-verification`].map((t) => `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${t}`).includes(r)) ||
      (/^kms:(Decrypt|DescribeKey)$/.test(a) && r === 'module.kms_pii.key_arn') ||
      (a === 'events:PutEvents' && r === 'aws_cloudwatch_event_bus.naleko_onboarding.arn');
    if (!ok) bad.push(`${a} on ${r}`);
  }
  return bad;
}

/** The blocks nested in a block body, by name ("route_settings"), as their bodies. */
export function nested(body: string, name: string): string[] {
  const src = stripComments(body);
  const out: string[] = [];
  const re = new RegExp(`(?:^|\\n)[ \\t]*${name}[ \\t]*\\{`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    const open = m.index + m[0].length - 1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '"') { i++; while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { out.push(src.slice(open + 1, i)); break; } }
    }
  }
  return out;
}

export function settings(fn: Block): Map<string, string> {
  return settingsOf(fn);
}

/** Files under a folder (no node_modules, coverage or tests), relative to the repo. */
export function filesUnder(dir: string, test: (path: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(join(REPO, d))) {
      if (name === 'node_modules' || name === 'coverage' || name.startsWith('.')) continue;
      const rel = `${d}/${name}`;
      if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
      else if (test(rel)) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}
