// CHAT-05: copied from ../../onb-22/fake-aws (code added only): a world with no `fetch` refuses every call, and the request line is
// recorded as op ('GET <url>') too, as the older harnesses record it.
// ONB-22: the fake fetch. Every call is recorded ({ service: 'http', method, url, headers, body }). No call leaves the process.
// world.fetch = { keys: [valid x-api-key values], rules: [{ method?, url?: substring, status, json }], default: { status, json } }.
//  - a call carrying an x-api-key that is not in `keys` is answered 401 {"message":"Unauthorized"} (the key authorizer);
//  - otherwise the first matching rule answers; otherwise `default` (200 {}).
// A host that is not the agent API's is refused, and any AI host fails the call.
import { calls, world } from './world.mjs';
export function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ service: 'http', op: `${method} ${String(url)}`, method, url: String(url), headers, body: init.body === undefined ? undefined : String(init.body) });
    if (/bedrock|anthropic|openai|textract|amazonaws\.com\/model/i.test(String(url))) throw new Error('CHAT-05 harness: an AI host was called. Nothing automated may call paid AI.');
    if (!world.fetch) throw new Error('CHAT-05 harness: no outbound HTTP call is allowed (the world has no fetch script)');
    const f = world.fetch;
    const answer = (status, json) => new Response(JSON.stringify(json ?? {}), { status, headers: { 'content-type': 'application/json' } });
    if (Array.isArray(f.keys) && headers['x-api-key'] !== undefined && !f.keys.includes(headers['x-api-key'])) return answer(401, { message: 'Unauthorized' });
    for (const r of f.rules ?? []) {
      if (r.method && r.method !== method) continue;
      if (r.url && !String(url).includes(r.url)) continue;
      return answer(r.status ?? 200, r.json);
    }
    return answer(f.default?.status ?? 200, f.default?.json ?? {});
  };
}
