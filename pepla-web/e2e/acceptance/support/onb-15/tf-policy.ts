import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributes, blocks, stripComments, tfFiles } from '../infra-harness';
import type { Policy } from '../ops-05/iam-eval';

/**
 * Reads getSingleDocumentVerification's role and policy from infra/*.tf as text (there is no Terraform
 * here; the PR's required Terraform check runs the real plan). The policy's `jsonencode({...})` is
 * turned into a policy document: `${var.aws_region}` is af-south-1, `${var.aws_account_id}` is
 * 000000000000, and any other reference stays as its own text ("module.kms_pii.key_arn").
 */

export const ROLE = 'get_single_document_verification';
export const BASELINE = join(__dirname, 'iam.get_single_document_verification.304dcbc.tf.txt');
export const REGION = 'af-south-1';
export const ACCOUNT = '000000000000';
export const table = (name: string) => `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${name}`;

export type TfResource = { type: string; name: string; raw: string; body: string; attrs: Map<string, string> };

/** Every `resource "<type>" "<name>"` with that type and name in the given files (or infra/*.tf). */
export function resourcesNamed(type: string, name: string, files = tfFiles()): TfResource[] {
  return blocks(files, 'resource')
    .filter((b) => b.labels[0] === type && b.labels[1] === name)
    .map((b) => ({ type, name, raw: b.raw, body: b.body, attrs: attributes(b.body) }));
}

/** The baseline file's two resources, as at 304dcbc. */
export function baseline(type: string): TfResource {
  const found = resourcesNamed(type, ROLE, [BASELINE]);
  if (found.length !== 1) throw new Error(`baseline has ${found.length} ${type}.${ROLE}`);
  return found[0]!;
}

/** Whitespace-free text, for "unchanged" comparisons. */
export const squash = (s: string) => stripComments(s).replace(/\s+/g, '');

/** `moved` and `removed` blocks anywhere in infra/*.tf, as text. */
export function movedOrRemoved(): string[] {
  return [...blocks(tfFiles(), 'moved'), ...blocks(tfFiles(), 'removed')].map((b) => squash(b.raw));
}

// ---------------------------------------------------------------- jsonencode({...}) to a policy document

type Tok = { t: 'str' | 'word' | 'punct'; v: string };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s|,/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let v = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') { v += src[j + 1]; j += 2; continue; }
        v += src[j];
        j++;
      }
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    if ('{}[]=:()'.includes(c)) { out.push({ t: 'punct', v: c }); i++; continue; }
    const m = /^[A-Za-z_][\w.\-*]*(\[[^\]]*\][\w.\-*]*)*/.exec(src.slice(i));
    if (!m) throw new Error(`policy text: cannot read "${src.slice(i, i + 30)}"`);
    out.push({ t: 'word', v: m[0] });
    i += m[0].length;
  }
  return out;
}

const interpolate = (s: string) => s.replace(/\$\{var\.aws_region\}/g, REGION).replace(/\$\{var\.aws_account_id\}/g, ACCOUNT);

function parse(toks: Tok[]): unknown {
  let i = 0;
  const value = (): unknown => {
    const t = toks[i++];
    if (!t) throw new Error('policy text ends early');
    if (t.t === 'str') return interpolate(t.v);
    if (t.t === 'word') return t.v === 'true' ? true : t.v === 'false' ? false : t.v;
    if (t.v === '[') {
      const list: unknown[] = [];
      while (toks[i] && toks[i]!.v !== ']') list.push(value());
      i++;
      return list;
    }
    if (t.v === '{') {
      const obj: Record<string, unknown> = {};
      while (toks[i] && toks[i]!.v !== '}') {
        const key = toks[i++]!;
        const eq = toks[i++];
        if (!eq || (eq.v !== '=' && eq.v !== ':')) throw new Error(`policy text: expected = after ${key.v}`);
        obj[key.v] = value();
      }
      i++;
      return obj;
    }
    throw new Error(`policy text: unexpected ${t.v}`);
  };
  return value();
}

/** The policy document of an aws_iam_role_policy's `policy = jsonencode({...})`. */
export function policyOf(r: TfResource): Policy {
  const src = stripComments(r.body);
  const at = /\bpolicy\s*=\s*jsonencode\s*\(/.exec(src);
  if (!at) throw new Error(`${r.type}.${r.name}: no policy = jsonencode(...)`);
  let depth = 0;
  let end = -1;
  for (let i = at.index + at[0].length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"') { i++; while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  return parse(tokens(src.slice(at.index + at[0].length, end))) as Policy;
}

export const readText = (p: string) => readFileSync(p, 'utf8');
