import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Rule 15: a schema validator, as a dev dependency of the tests only (the builder adds "ajv" to pepla-web's devDependencies).
import Ajv from 'ajv';
import { REPO } from './lambda-harness';

/**
 * REC-14 rules 14 and 15: the contract is written once, in api/openapi.yaml, and every answer the real Lambda gives is checked against it.
 * The file is read as written (support/rec-14/openapi_doc.py, PyYAML) and its components are handed to Ajv, so a `$ref` to
 * `#/components/schemas/<Name>` resolves to the named schema. OpenAPI 3.0 keywords Ajv does not know (example, nullable, ...) are ignored.
 */

export const OPENAPI = join(REPO, 'api', 'openapi.yaml');
export type Doc = { paths?: Record<string, any>; components?: { schemas?: Record<string, any> } };

export function readDoc(file = OPENAPI): Doc {
  return JSON.parse(execFileSync('python3', ['-I', join(__dirname, 'openapi_doc.py'), file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as Doc;
}

/** The operation for a route key ("GET /v1/company/departments"), or undefined. */
export function operation(doc: Doc, route: string): any {
  const [method, path] = route.split(' ') as [string, string];
  return doc.paths?.[path]?.[method.toLowerCase()];
}

/** The JSON schema of the answer an operation gives with this status code, or undefined when the file does not describe it. */
export function answerSchema(doc: Doc, route: string, status: number): any {
  const op = operation(doc, route);
  return op?.responses?.[String(status)]?.content?.['application/json']?.schema;
}

const withRefs = (node: any): any => {
  if (Array.isArray(node)) return node.map(withRefs);
  if (node && typeof node === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) out[k] = k === '$ref' && typeof v === 'string' && v.startsWith('#/') ? `openapi.json${v}` : withRefs(v);
    return out;
  }
  return node;
};

export type Checker = { check: (schema: any, value: unknown) => string[] };
/** A validator over the file's components. `check` answers the problems (empty when the value passes). */
export function checker(doc: Doc): Checker {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  ajv.addSchema({ $id: 'openapi.json', components: withRefs(doc.components ?? {}) });
  return {
    check(schema, value) {
      if (!schema) return ['the file describes no JSON answer here'];
      let validate;
      try {
        validate = ajv.compile(withRefs(schema));
      } catch (e: any) {
        return [`the schema does not compile: ${String(e?.message ?? e).slice(0, 200)}`];
      }
      return validate(value) ? [] : (validate.errors ?? []).map((e: any) => `${e.instancePath || '(answer)'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`);
    },
  };
}

/** The schema an operation's answer names, with a `$ref` followed (one level) to the named component. */
export function refName(schema: any): string | undefined {
  const ref = schema?.$ref;
  return typeof ref === 'string' ? /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1] : undefined;
}

/**
 * Rule 14: every object in a schema (followed through `$ref`, any depth) says `additionalProperties: false` and lists every property it
 * has in `required`. Answers the objects that do not, by where they are.
 */
export function looseObjects(doc: Doc, schema: any, where = '(answer)', seen = new Set<string>(), optional: string[] = []): string[] {
  const out: string[] = [];
  const walk = (s: any, at: string) => {
    if (!s || typeof s !== 'object') return;
    if (typeof s.$ref === 'string') {
      const name = /^#\/components\/schemas\/(.+)$/.exec(s.$ref)?.[1];
      if (!name) { out.push(`${at}: $ref ${s.$ref} is not a named schema`); return; }
      if (seen.has(name)) return;
      seen.add(name);
      const target = doc.components?.schemas?.[name];
      if (!target) { out.push(`${at}: $ref ${s.$ref} names no schema`); return; }
      walk(target, `${at} -> ${name}`);
      return;
    }
    for (const k of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(s[k])) s[k].forEach((x: any, i: number) => walk(x, `${at}.${k}[${i}]`));
    if (s.type === 'object' || s.properties) {
      if (s.additionalProperties !== false) out.push(`${at}: an object without additionalProperties: false`);
      const props = Object.keys(s.properties ?? {});
      const req: string[] = Array.isArray(s.required) ? s.required : [];
      const missing = props.filter((p) => !req.includes(p) && !optional.includes(p));
      if (missing.length) out.push(`${at}: ${missing.join(', ')} not in required`);
      for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${at}.${k}`);
    }
    if (s.items) walk(s.items, `${at}[]`);
  };
  walk(schema, where);
  return out;
}

export const yamlText = () => readFileSync(OPENAPI, 'utf8');
