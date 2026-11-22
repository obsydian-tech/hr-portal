import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attributes, blocks, stripComments, type Block } from '../infra-harness';
import { policyOf, squash as tfSquash } from '../onb-15/tf-policy';
import { REPO } from './lambda-harness';

/**
 * MOD-01: both Terraform stacks (infra/ and talent-flow-infra/) read as text. There is no Terraform here; the PR's
 * required Terraform check runs the real plan. Locals that are plain strings are resolved (TalentFlow names every
 * Lambda and role through them), so a Lambda can be found by its function name in either stack.
 */

export const STACKS = ['infra', 'talent-flow-infra'] as const;
export type Stack = (typeof STACKS)[number];
export const filesOf = (stack: Stack) => readdirSync(join(REPO, stack)).filter((f) => f.endsWith('.tf')).map((f) => join(REPO, stack, f));
export const squash = tfSquash;

/** Every `name = "string"` inside a stack's `locals { }` blocks, with ${local.x} inside resolved. */
export function localsOf(stack: Stack): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const b of blocks(filesOf(stack), 'locals')) {
    for (const [k, v] of attributes(b.body)) if (/^"[^"]*"$/.test(v)) raw[k] = v.slice(1, -1);
  }
  const out: Record<string, string> = {};
  const res = (s: string, depth = 0): string => (depth > 5 ? s : s.replace(/\$\{local\.(\w+)\}/g, (m, k) => (raw[k] !== undefined ? res(raw[k]!, depth + 1) : m)));
  for (const [k, v] of Object.entries(raw)) out[k] = res(v);
  return out;
}

/** An attribute value (text without whitespace) as a string: quotes off, local.x and ${local.x} resolved. */
export function valueOf(stack: Stack, v: string | undefined): string {
  if (v === undefined) return '';
  const L = localsOf(stack);
  const bare = /^local\.(\w+)$/.exec(v);
  if (bare) return L[bare[1]!] ?? v;
  const s = /^"(.*)"$/.exec(v)?.[1] ?? v;
  return s.replace(/\$\{local\.(\w+)\}/g, (m, k) => L[k] ?? m);
}

export const resourcesOf = (stack: Stack, type: string) => blocks(filesOf(stack), 'resource').filter((b) => b.labels[0] === type);

/** The aws_lambda_function whose function name is `fn`, in whichever stack has it. */
export function lambdaNamed(fn: string): { stack: Stack; block: Block }[] {
  const out: { stack: Stack; block: Block }[] = [];
  for (const stack of STACKS) {
    for (const b of resourcesOf(stack, 'aws_lambda_function')) {
      if (valueOf(stack, attributes(b.body).get('function_name')) === fn) out.push({ stack, block: b });
    }
  }
  return out;
}

/** The role resource a function runs as (aws_iam_role.<name>.arn), or undefined. */
export const roleResourceOf = (fn: Block) => /^aws_iam_role\.([\w-]+)\.arn$/.exec(attributes(fn.body).get('role') ?? '')?.[1];

/** A role's IAM name and path, resolved. */
export function roleInfo(stack: Stack, role: string): { name: string; path: string } | undefined {
  const b = resourcesOf(stack, 'aws_iam_role').find((x) => x.labels[1] === role);
  if (!b) return undefined;
  const a = attributes(b.body);
  return { name: valueOf(stack, a.get('name')), path: valueOf(stack, a.get('path')) || '/' };
}

export type PolicyLines = { role: string; stack: Stack; pairs?: string[]; squash?: string };
const L = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [v as string]);

/**
 * Every aws_iam_role_policy of both stacks, keyed `<stack>/<resource name>`, as "Effect action resource condition"
 * lines (one per action and resource). A policy that cannot be read as a document is kept as squashed text.
 */
export function policyLines(): Record<string, PolicyLines> {
  const out: Record<string, PolicyLines> = {};
  for (const stack of STACKS) {
    for (const b of resourcesOf(stack, 'aws_iam_role_policy')) {
      const role = (attributes(b.body).get('role') ?? '').replace(/^aws_iam_role\./, '').replace(/\.(name|id)$/, '');
      const r = { type: 'aws_iam_role_policy', name: b.labels[1]!, raw: b.raw, body: b.body, attrs: attributes(b.body) };
      try {
        const doc: any = policyOf(r);
        const st = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
        const pairs = st.flatMap((x: any) => [...L(x.Action), ...L(x.NotAction).map((a) => `NotAction:${a}`)].flatMap((a) => [...L(x.Resource), ...L(x.NotResource).map((n) => `NotResource:${n}`)].map((res) => `${x.Effect ?? ''} ${a} ${res} ${JSON.stringify(x.Condition ?? null)}`)));
        out[`${stack}/${b.labels[1]}`] = { role, stack, pairs: pairs.sort() };
      } catch {
        out[`${stack}/${b.labels[1]}`] = { role, stack, squash: tfSquash(b.body) };
      }
    }
  }
  return out;
}

/** A resource text that names the company list (the tenants table itself, not an index). */
export const TENANTS_RESOURCE = /^(aws_dynamodb_table\.tenants\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants))$/;

/** The kms_pii module's `name = [ ... ]` list, squashed (comments out). */
export function kmsList(name: 'dynamodb_read_role_arns' | 'allowed_role_arns'): string {
  const kms = blocks([join(REPO, 'infra', 'kms.tf')], 'module').find((b) => b.labels[0] === 'kms_pii');
  return kms ? (attributes(kms.body).get(name) ?? '') : '';
}

/** The `variables = { ... }` of a function's environment block, as name -> value text (no whitespace). */
export function settingsOf(fn: Block): Map<string, string> {
  const src = stripComments(fn.body);
  const env = /(?:^|\n)[ \t]*environment[ \t]*\{/.exec(src);
  if (!env) return new Map();
  const rest = src.slice(env.index);
  const m = /variables\s*=\s*\{/.exec(rest);
  if (!m) return new Map();
  let depth = 0;
  const open = m.index + m[0].length - 1;
  for (let i = open; i < rest.length; i++) {
    const c = rest[i];
    if (c === '"') { i++; while (i < rest.length && rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return attributes(rest.slice(open + 1, i)); }
  }
  return new Map();
}

/** The `lambda_names = [...]` of a module in infra/<file>, squashed. */
export function lambdaNamesIn(file: string): string {
  const mod = blocks([join(REPO, 'infra', file)], 'module')[0];
  return mod ? (attributes(mod.body).get('lambda_names') ?? '') : '';
}

export const readTf = (stack: Stack) => filesOf(stack).map((f) => readFileSync(f, 'utf8')).join('\n');
