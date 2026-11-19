import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INFRA, attributes, blocks, stripComments, tfFiles, type Block } from '../infra-harness';
import { grants, lambdaNamed, list, nested, resources, settingsOf, type Stmt } from '../ten-01/tf';

/**
 * ONB-21: infra/*.tf read as text (there is no Terraform here; the PR's required Terraform check runs the real plan).
 * The reminder function, its role, its table, its rule: found by what they are (function_name, the role name, the table's
 * name), not by the label the builder chose.
 */
export const FUNCTION_NAME = 'sendDocumentReminders';
export const ROLE_NAME = 'naleko-sendDocumentReminders-role';
export const REMINDERS_TF = join(INFRA, 'reminders.tf');
export const squash = (s: string) => stripComments(s).replace(/\s+/g, '');
export const unquote = (s: string | undefined) => (s ?? '').replace(/^"|"$/g, '');

export const fn = (): Block => lambdaNamed(FUNCTION_NAME);
export const fnLabel = () => fn().labels[1]!;

export function role(): Block {
  const found = resources('aws_iam_role').filter((b) => unquote(attributes(b.body).get('name')) === ROLE_NAME);
  if (found.length !== 1) throw new Error(`one aws_iam_role named "${ROLE_NAME}" in infra/*.tf (found ${found.length})`);
  return found[0]!;
}
export const roleLabel = () => role().labels[1]!;

/** The aws_dynamodb_table resources by label, with the table name each one has (interpolations left as text). */
export function tablesByLabel(): Map<string, { block: Block; name: string }> {
  const out = new Map<string, { block: Block; name: string }>();
  for (const b of resources('aws_dynamodb_table')) out.set(b.labels[1]!, { block: b, name: unquote(attributes(b.body).get('name')) });
  return out;
}

export type Table = 'employees' | 'documents' | 'tenants' | 'reminders' | 'other';
export type Target = { table: Table; index?: string; star: boolean; raw: string };

/** Which table (and index) a DynamoDB resource string in a policy names. */
export function targetOf(res: string): Target {
  const raw = res;
  const star = /\*/.test(res);
  const flat = res.replace(/\$\{([^}]*)\}/g, '$1');
  let name: string | undefined;
  let index: string | undefined;
  let m = /table\/([^/]+)(?:\/index\/(.+))?$/.exec(flat);
  if (m) {
    name = m[1];
    index = m[2];
  } else if ((m = /^aws_dynamodb_table\.([\w-]+)\.arn(?:\/index\/(.+))?$/.exec(flat))) {
    name = tablesByLabel().get(m[1]!)?.name ?? m[1];
    index = m[2];
  }
  const n = name ?? '';
  const table: Table = n === 'employees' ? 'employees' : n === 'documents' ? 'documents' : /-tenants$/.test(n) ? 'tenants' : /-reminders$/.test(n) ? 'reminders' : 'other';
  return { table, index, star, raw };
}

/** Every Allow statement of the role's policy with its actions and targets. */
export function policy(): { statements: Stmt[]; managed: string[] } {
  const g = grants(roleLabel());
  return { statements: g.statements, managed: g.managed };
}

/** Every `Condition` key and its values, whatever the operator. */
export function conditionKeys(c: unknown): { operator: string; key: string; values: string[] }[] {
  const out: { operator: string; key: string; values: string[] }[] = [];
  if (!c || typeof c !== 'object') return out;
  for (const [operator, body] of Object.entries(c as Record<string, unknown>)) {
    if (!body || typeof body !== 'object') continue;
    for (const [key, v] of Object.entries(body as Record<string, unknown>)) out.push({ operator, key, values: list(v) });
  }
  return out;
}

export const settings = () => settingsOf(fn());

/** Entries of one list attribute (`name = [ ... ]`) of a block body, each squashed, split at the top level. */
export function listEntries(body: string, attr: string): string[] {
  const src = stripComments(body);
  const m = new RegExp(`(?:^|\\n)\\s*${attr}\\s*=\\s*\\[`).exec(src);
  if (!m) return [];
  let i = m.index + m[0].length;
  let depth = 1;
  let cur = '';
  const out: string[] = [];
  for (; i < src.length && depth > 0; i++) {
    const c = src[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      cur += src.slice(i, j + 1);
      i = j;
    } else if (c === '[' || c === '(' || c === '{') {
      depth++;
      cur += c;
    } else if (c === ']' || c === ')' || c === '}') {
      depth--;
      if (depth > 0) cur += c;
    } else if (c === ',' && depth === 1) {
      if (cur.trim()) out.push(cur.replace(/\s+/g, ''));
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.replace(/\s+/g, ''));
  return out;
}

/** The two lists of module "kms_pii" in infra/kms.tf. */
export function kmsLists(): { allowed: string[]; readers: string[] } {
  const mod = blocks([join(INFRA, 'kms.tf')], 'module').find((b) => b.labels[0] === 'kms_pii');
  if (!mod) throw new Error('module "kms_pii" is not in infra/kms.tf');
  return { allowed: listEntries(mod.body, 'allowed_role_arns'), readers: listEntries(mod.body, 'dynamodb_read_role_arns') };
}

/** A tfvars value that is not a string (`name = true`). */
export function tfvarRaw(file: string, name: string): string | undefined {
  return new RegExp(`^\\s*${name}\\s*=\\s*([^\\s#]+)`, 'm').exec(stripComments(readFileSync(file, 'utf8')))?.[1];
}

/** Every file under infra/ (the .tf files, the step function definitions, the modules), as paths. */
export function infraFiles(dir = INFRA): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === '.terraform' || f === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...infraFiles(p));
    else out.push(p);
  }
  return out;
}

export { INFRA, attributes, blocks, nested, resources, stripComments, tfFiles, existsSync };
