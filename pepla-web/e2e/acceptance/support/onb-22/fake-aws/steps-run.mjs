// ONB-22: runs a warm container through a list of steps, in one process, under the same fake AWS as run.mjs:
//   node --import ./register.mjs steps-run.mjs <mode> <module file> <steps file>
// mode "mcp": the module is the MCP server's Lambda handler (lambda-handler.mjs). A step { call: <event> } hands it the event
//   with a response stream (awslambda.streamifyResponse and HttpResponseStream are shimmed) and records status, headers, body.
// mode "resolver": the module is lambda/nalekoAiChat/tool-resolver.mjs. A step { resolve: { tool, args, context } } calls
//   resolveToolCall and records the answer or the error's message.
// Other steps: { rotate: { secretId, set } } replaces the secret's versions, { advance: ms } moves the clock forward,
// { fetch: <world.fetch> } replaces the fake agent API's rules. Each answer records which http calls it made (httpFrom..httpTo).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { calls, world } from './world.mjs';
import { installFetch } from './fetch.mjs';
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[level] = (...args) => calls.push({ service: 'log', level: `console.${level}`, message: format(...args) });
}
installFetch();
globalThis.awslambda = { streamifyResponse: (fn) => fn, HttpResponseStream: { from(stream, meta) { stream.meta = meta; return stream; } } };
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const [mode, moduleFile, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const out = { calls, answers: [] };
const httpCount = () => calls.filter((c) => c.service === 'http').length;
try {
  const mod = await import(pathToFileURL(moduleFile).href);
  for (const step of steps) {
    if (step.rotate) { world.secrets[step.rotate.secretId] = step.rotate.set; continue; }
    if (step.advance) { offset += step.advance; continue; }
    if (step.fetch) { world.fetch = step.fetch; continue; }
    const from = httpCount();
    if (mode === 'mcp' && step.call) {
      const stream = { chunks: [], meta: undefined, write(c) { this.chunks.push(String(c)); return true; }, end(c) { if (c) this.chunks.push(String(c)); } };
      const returned = await mod.handler(step.call, stream, { awsRequestId: 'onb-22-mcp' });
      const meta = stream.meta ?? (returned && returned.statusCode ? { statusCode: returned.statusCode, headers: returned.headers } : {});
      out.answers.push({ status: meta.statusCode, headers: meta.headers, body: stream.chunks.join('') || (typeof returned?.body === 'string' ? returned.body : ''), httpFrom: from, httpTo: httpCount() });
    } else if (mode === 'resolver' && step.resolve) {
      try {
        const result = await mod.resolveToolCall(step.resolve.tool, step.resolve.args ?? {}, step.resolve.context ?? {});
        out.answers.push({ result, httpFrom: from, httpTo: httpCount() });
      } catch (e) {
        out.answers.push({ error: String(e?.message ?? e), httpFrom: from, httpTo: httpCount() });
      }
    } else throw new Error('steps-run: unknown step ' + JSON.stringify(step).slice(0, 100));
  }
} catch (e) {
  out.error = { name: e?.name, message: String(e?.message ?? e), stack: String(e?.stack ?? e) };
}
out.tables = world.tables;
process.stdout.write('\n@@ONB22@@' + JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)) + '\n');
