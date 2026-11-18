import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEN-04: what Terraform says, read as text (no AWS, no network). The tests' own reading, so they do not trust the
 * builder's script: every route key of the four APIs, how it is guarded, which API it is on, and which Lambda
 * folder answers it.
 *
 * Pinned reading (spec rule 2, "found through the route's integration and the Lambda's source path"):
 *   aws_apigatewayv2_route.target "integrations/${aws_apigatewayv2_integration.<I>.id}"
 *   -> the integration's integration_uri "(data.)aws_lambda_function.<L>.invoke_arn"
 *   -> that resource's function_name: a string, or local.<name> whose value is a string in a locals block
 *   -> the folder lambda/<function_name>/ (its .js .mjs .cjs files, not tests, not node_modules).
 */

export type Guard = 'jwt' | 'agent-key' | 'none';
export type ApiName = 'employees' | 'documents' | 'agent' | 'talentflow';
export type TfRoute = { key: string; method: string; path: string; guard: Guard; api: ApiName; handler: string | null; file: string };

function walkTf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkTf(p));
    else if (e.endsWith('.tf')) out.push(p);
  }
  return out;
}
// Whole-line comments only: a block-comment pattern would eat from a slash-star in an ARN glob to the next star-slash.
export const stripTf = (s: string) => s.replace(/^\s*(#|\/\/).*$/gm, '');

function blocksOf(text: string, header: RegExp): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = new RegExp(header.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = re.lastIndex;
    let depth = 1;
    while (depth > 0 && i < text.length) {
      const c = text[i++];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    out.push({ name: m[1]!, body: text.slice(re.lastIndex, i - 1) });
  }
  return out;
}

export function terraformRoutes(root: string): TfRoute[] {
  const files = [...walkTf(join(root, 'infra')), ...walkTf(join(root, 'talent-flow-infra'))].sort();
  const per = files.map((f) => ({ f, text: stripTf(readFileSync(f, 'utf8')) }));
  const all = per.map((x) => x.text).join('\n');
  const locals = new Map<string, string>();
  for (const m of all.matchAll(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"$]*)"\s*$/gm)) locals.set(m[1]!, m[2]!);
  const integrations = new Map<string, string>();
  for (const b of blocksOf(all, /resource\s+"aws_apigatewayv2_integration"\s+"([^"]+)"\s*\{/)) {
    const u = /integration_uri\s*=\s*(data\.)?aws_lambda_function\.([A-Za-z0-9_]+)\.invoke_arn/.exec(b.body);
    if (u) integrations.set(b.name, `${u[1] ? 'data.' : ''}${u[2]}`);
  }
  const fnName = (ref: string): string | null => {
    const data = ref.startsWith('data.');
    const name = data ? ref.slice(5) : ref;
    const blocks = blocksOf(all, data ? /data\s+"aws_lambda_function"\s+"([^"]+)"\s*\{/ : /resource\s+"aws_lambda_function"\s+"([^"]+)"\s*\{/);
    const b = blocks.find((x) => x.name === name);
    const expr = /function_name\s*=\s*(.+)/.exec(b?.body ?? '')?.[1]?.trim() ?? '';
    const lit = /^"([^"$]*)"$/.exec(expr);
    if (lit) return lit[1]!;
    const loc = /^local\.([A-Za-z0-9_]+)$/.exec(expr);
    return loc ? locals.get(loc[1]!) ?? null : null;
  };
  const routes: TfRoute[] = [];
  for (const { f, text } of per) {
    for (const b of blocksOf(text, /resource\s+"aws_apigatewayv2_route"\s+"([^"]+)"\s*\{/)) {
      const key = /route_key\s*=\s*"([^"]+)"/.exec(b.body)?.[1];
      if (!key) continue;
      const [method, path] = key.split(' ') as [string, string];
      const auth = /authorization_type\s*=\s*"([^"]+)"/.exec(b.body)?.[1];
      const guard: Guard = auth === 'JWT' ? 'jwt' : auth === 'CUSTOM' ? 'agent-key' : 'none';
      const apiExpr = /api_id\s*=\s*(\S+)/.exec(b.body)?.[1] ?? '';
      const api: ApiName = /employees_api/.test(apiExpr) ? 'employees' : /document_upload_api/.test(apiExpr) ? 'documents' : /agent_api|agent_api_id/.test(apiExpr) ? 'agent' : 'talentflow';
      const integ = /integrations\/\$\{aws_apigatewayv2_integration\.([A-Za-z0-9_]+)\.id\}/.exec(b.body)?.[1];
      const ref = integ ? integrations.get(integ) : undefined;
      routes.push({ key, method, path, guard, api, handler: ref ? fnName(ref) : null, file: f.slice(root.length + 1) });
    }
  }
  return routes;
}

/** The handler's own source (all .js .mjs .cjs files under lambda/<name>, not tests, not node_modules), comments removed. */
export function handlerSource(root: string, name: string): string | null {
  const dir = join(root, 'lambda', name);
  if (!existsSync(dir)) return null;
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs)$/.test(e) && !/\.test\./.test(e)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
