import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Terraform files read as text, for the OPS-05 acceptance tests.
 * No Terraform binary, no providers, no AWS. Same approach as the BE-16
 * checks, kept in its own folder so the two cards never share a locked file.
 */

export const REPO = resolve(__dirname, '..', '..', '..', '..', '..');
export const rel = (p: string) => relative(REPO, p);

/** HCL with # // and /* *\/ comments blanked out (same length, so offsets match), strings and heredocs kept. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '#' || two === '//') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (two === '<<') {
      const m = /^<<-?([A-Za-z_]+)\n/.exec(src.slice(i));
      if (!m) {
        out += c;
        i++;
        continue;
      }
      const endRe = new RegExp(`\\n\\s*${m[1]}\\s*(\\n|$)`);
      const rest = src.slice(i + m[0].length - 1);
      const e = endRe.exec(rest);
      const stop = e ? i + m[0].length - 1 + e.index + e[0].length : src.length;
      out += src.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

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
  throw new Error('Unbalanced braces in Terraform file');
}

export type Block = { file: string; labels: string[]; body: string; raw: string };

/** Blocks of one kind (`resource`, `import`, `removed`, `lifecycle`, ...) at the top of `src`. */
export function blocksIn(src: string, kind: string, file = ''): Block[] {
  const found: Block[] = [];
  const re = new RegExp(`^[ \\t]*${kind}((?:[ \\t]+"[^"]*")*)[ \\t]*\\{`, 'gm');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    const end = closeBrace(src, open);
    const labels = [...m[1].matchAll(/"([^"]*)"/g)].map((l) => l[1]);
    found.push({ file, labels, body: src.slice(open + 1, end - 1), raw: src.slice(m.index, end) });
    re.lastIndex = end;
  }
  return found;
}

/** Top-level blocks of one kind in the given .tf files (comments removed). */
export function blocks(files: string[], kind: string): Block[] {
  return files.flatMap((f) => blocksIn(stripComments(readFileSync(f, 'utf8')), kind, f));
}

/** Top-level `name = value` pairs of a block body, value without whitespace. Nested blocks are left out. */
export function attributes(body: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let depth = 0;
  let current: { key: string; value: string } | undefined;
  for (const line of body.split('\n')) {
    if (depth === 0) {
      if (current) attrs.set(current.key, current.value.replace(/\s+/g, ''));
      current = undefined;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)(.*)$/.exec(line);
      if (m) current = { key: m[1], value: m[2] };
    } else if (current) current.value += line;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        i++;
        while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
      } else if ('{[('.includes(c)) depth++;
      else if ('}])'.includes(c)) depth--;
    }
  }
  if (current) attrs.set(current.key, current.value.replace(/\s+/g, ''));
  return attrs;
}

/** Every .tf file under a folder, modules included, `.terraform` left out. */
export function tfFilesDeep(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '.terraform' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tfFilesDeep(p));
    else if (name.endsWith('.tf')) out.push(p);
  }
  return out.sort();
}

/** .tf files directly in one folder (one Terraform root, no modules). */
export function tfFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tf'))
    .map((f) => join(dir, f))
    .sort();
}

/** `resource "<type>" "<name>"` blocks. */
export const resources = (files: string[], type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);

/** The lifecycle block inside a resource body, if any. */
export function lifecycleOf(b: Block): Map<string, string> | undefined {
  const lc = blocksIn(b.body, 'lifecycle');
  return lc.length ? attributes(lc[0].body) : undefined;
}

/** String locals of a root (`locals { a = "x" }`), resolved where they refer to each other. */
export function stringLocals(files: string[]): Map<string, string> {
  const raw = new Map<string, string>();
  for (const b of blocks(files, 'locals')) for (const [k, v] of attributes(b.body)) raw.set(k, v);
  const out = new Map<string, string>();
  const resolveOne = (v: string, depth = 0): string | undefined => {
    if (depth > 10) return undefined;
    const r = resolveString(v, (name) => {
      const inner = raw.get(name);
      return inner === undefined ? undefined : resolveOne(inner, depth + 1);
    });
    return r;
  };
  for (const [k, v] of raw) {
    const r = resolveOne(v);
    if (r !== undefined) out.set(k, r);
  }
  return out;
}

/**
 * The literal value of an HCL string expression: `"abc"`, `"a-${local.b}"`
 * or `local.b`. Undefined when it depends on anything but string locals.
 */
export function resolveString(expr: string, local: (name: string) => string | undefined): string | undefined {
  const bare = /^local\.([A-Za-z0-9_]+)$/.exec(expr);
  if (bare) return local(bare[1]);
  const m = /^"(.*)"$/.exec(expr);
  if (!m) return undefined;
  let failed = false;
  const s = m[1].replace(/\$\{([^}]*)\}/g, (_, inner: string) => {
    const l = /^local\.([A-Za-z0-9_]+)$/.exec(inner.trim());
    const v = l ? local(l[1]) : undefined;
    if (v === undefined) failed = true;
    return v ?? '';
  });
  return failed ? undefined : s;
}

/** Text of a file, or '' when it does not exist. */
export const readText = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
