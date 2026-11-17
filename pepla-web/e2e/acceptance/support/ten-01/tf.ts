import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { attributes, blocks, stripComments, tfFiles, type Block } from '../infra-harness';
import { policyOf, type TfResource } from '../onb-15/tf-policy';

/**
 * TEN-01: infra/*.tf read as text (there is no Terraform here; the PR's required Terraform check runs the real
 * plan). Block helpers copied from ONB-24's terraform checks (67fa0da) so this card stands on its own.
 */

export const squash = (s: string) => stripComments(s).replace(/\s+/g, '');
export const all = () => tfFiles();
export const resources = (type: string, files = all()) => blocks(files, 'resource').filter((b) => b.labels[0] === type);

/** Index just after the brace that closes the one at `open` (strings skipped). */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unbalanced braces');
}

/** Nested blocks `kind {` and `dynamic "kind" {` inside `body`, at any depth. Returns raw text. */
export function nested(body: string, kind: string): string[] {
  const src = stripComments(body);
  const out: string[] = [];
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:${kind}|dynamic[ \\t]+"${kind}")[ \\t]*\\{`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    const end = closeBrace(src, open);
    out.push(src.slice(m.index, end).trim());
    re.lastIndex = end;
  }
  return out;
}

/** The inside of a nested block's raw text (`kind { ... }` -> `...`). */
export const inside = (raw: string) => raw.replace(/^[^{]*\{/, '').replace(/\}\s*$/, '');

/** The body with every nested `kind` block taken out. */
export function without(body: string, kind: string): string {
  let src = stripComments(body);
  for (const b of nested(src, kind)) src = src.replace(b, '');
  return src;
}

/** The aws_lambda_function whose function_name is `fn`. */
export function lambdaNamed(fn: string): Block {
  const found = resources('aws_lambda_function').filter((b) => attributes(b.body).get('function_name') === `"${fn}"`);
  expect(found.length, `one aws_lambda_function named "${fn}" in infra/*.tf`).toBe(1);
  return found[0]!;
}

/** The `variables = { ... }` of a function's environment block, as name -> value text (no whitespace). */
export function settingsOf(fn: Block): Map<string, string> {
  const env = nested(fn.body, 'environment')[0];
  if (!env) return new Map();
  const m = /variables\s*=\s*\{/.exec(env);
  if (!m) return new Map();
  const open = m.index + m[0].length - 1;
  const end = closeBrace(env, open);
  return attributes(env.slice(open + 1, end - 1));
}

export function roleOf(fn: Block): string {
  const role = attributes(fn.body).get('role') ?? '';
  const m = /^aws_iam_role\.([\w-]+)\.arn$/.exec(role);
  expect(m, `${fn.labels[1]}: role = aws_iam_role.<name>.arn (got ${role})`).toBeTruthy();
  return m![1]!;
}

export type Stmt = { Effect?: string; Action?: string | string[]; Resource?: string | string[]; Condition?: unknown; [k: string]: unknown };
export const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [v as string]);

/** Every statement the role's inline policies grant, and the managed policies attached to it. */
export function grants(role: string): { statements: Stmt[]; managed: string[]; policies: Block[] } {
  const statements: Stmt[] = [];
  const policies = resources('aws_iam_role_policy').filter((b) => new RegExp(`^aws_iam_role\\.${role}\\.(name|id)$`).test(attributes(b.body).get('role') ?? ''));
  expect(policies.length, `aws_iam_role.${role} has an inline policy`).toBeGreaterThanOrEqual(1);
  for (const b of policies) {
    const r: TfResource = { type: 'aws_iam_role_policy', name: b.labels[1]!, raw: b.raw, body: b.body, attrs: attributes(b.body) };
    const doc = policyOf(r) as unknown as { Statement: Stmt | Stmt[] };
    statements.push(...(Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement]));
  }
  const managed = resources('aws_iam_role_policy_attachment')
    .filter((b) => new RegExp(`^aws_iam_role\\.${role}\\.(name|id)$`).test(attributes(b.body).get('role') ?? ''))
    .map((b) => attributes(b.body).get('policy_arn') ?? '');
  return { statements, managed, policies };
}

/** Every statement: allowed only if `ok` answers null. Returns the actions granted. */
export function expectOnly(role: string, what: string, ok: (action: string, resources: string[]) => string | null): string[] {
  const { statements, managed } = grants(role);
  expect(managed.filter((m) => !/AWSXRayDaemonWriteAccess"?$/.test(m)), `${what}: no managed policy beyond X-Ray`).toEqual([]);
  const actions: string[] = [];
  for (const s of statements) {
    expect(s.Effect, `${what}: Allow statements only`).toBe('Allow');
    expect(s['NotAction'] ?? s['NotResource'], `${what}: no NotAction or NotResource`).toBeUndefined();
    const res = list(s.Resource);
    for (const a of list(s.Action)) {
      expect(a, `${what}: no wildcard action`).not.toMatch(/\*/);
      const why = ok(a, res);
      expect(why, `${what}: ${a} on ${res.join(', ')} is not allowed`).toBeNull();
      actions.push(a);
    }
  }
  return actions;
}

export const LOGS = new Set(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents']);
export const XRAY = new Set(['xray:PutTraceSegments', 'xray:PutTelemetryRecords']);

/** Logs on the function's own log group and X-Ray are always fine; Resource "*" is fine only for X-Ray. */
export function common(fn: string, a: string, res: string[]): string | null | undefined {
  if (LOGS.has(a)) return res.every((r) => r.includes(`log-group:/aws/lambda/${fn}`)) ? null : 'logs only on its own log group';
  if (XRAY.has(a)) return null;
  if (res.includes('*')) return 'Resource "*" only for X-Ray';
  return undefined;
}

/** A tfvars file's `name = "value"`. */
export function tfvar(file: string, name: string): string | undefined {
  const src = stripComments(readFileSync(file, 'utf8'));
  return new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(src)?.[1];
}
