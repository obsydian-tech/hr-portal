import { ROWS, TENANT_A_QUERY, A_BODY, type Kind } from './rows';
import { LOGIN_ROLES, type LoginName, type OpInfo, type Req, type Res, type Send, type World } from './walk';

/**
 * TEN-04 AC-7: a small model of the API, to run the walk against in the no-backend run. It follows the file's own
 * x-tenant and x-roles (so it is only as complete as the file), keeps two companies, and can be told to leak in one of
 * the ways the walk exists to catch. `leak` names the one planted fault; none means a correct API.
 */
export type Leak =
  | 'none'
  | 'id-200'           // another company's id answers 200 with the row
  | 'id-echo'          // the 404 body names A's email
  | 'list-all'         // a list holds every company's rows
  | 'list-query'       // a list honours ?tenantId=
  | 'write-through'    // B's write changes A's row while answering 404
  | 'create-from-body' // a create takes the company from the body
  | 'agent-all'        // the agent key sees every company
  | 'role-open'        // the role check is gone
  | 'stored-leak'      // a made-up token answers with A's data
  | 'forbidden-body'   // the 403 body says something else
  | 'notfound-body';   // the 404 body says something else

type Item = { id: string; kind: Kind; co: 'A' | 'B'; name: string; email: string; v: number };
const EMAIL = (co: string, kind: string) => `${co === 'A' ? 'pepla-demo-naledi.dlamini' : 'zanele.companyb'}-${kind}@blackhole.postmarkapp.com`;

export function makeModel(ops: OpInfo[], w: World, leak: Leak): { send: Send; items: Item[] } {
  const info = new Map(ops.map((o) => [o.key, o]));
  const items: Item[] = [];
  for (const [kind, id] of Object.entries(w.ids)) items.push({ id, kind: kind as Kind, co: 'A', name: `Naledi ${kind}`, email: EMAIL('A', kind), v: 0 });
  for (const kind of Object.keys(w.ids)) items.push({ id: `ten04-b-${kind}`, kind: kind as Kind, co: 'B', name: `Zanele ${kind}`, email: EMAIL('B', kind), v: 0 });
  const coOf = (login: Req['login']): 'A' | 'B' | null => (login === 'agent' ? 'A' : login === 'anon' ? null : login.endsWith('A') ? 'A' : 'B');
  const rolesOk = (login: Req['login'], roles: string[]) => leak === 'role-open' || roles.length === 0 || (login !== 'anon' && login !== 'agent' && LOGIN_ROLES[login as LoginName].some((r) => roles.includes(r)));
  const show = (i: Item) => ({ id: i.id, name: i.name, email: i.email, v: i.v });
  const kindOfList = (key: string): Kind | null => {
    const m: [RegExp, Kind][] = [[/employees|me\b|hr-partners|by-email|email-check/, 'employee'], [/verifications|documents/, 'document'], [/candidates|panel|hiring|offer/, 'candidate'], [/tiles/, 'tile'], [/config/, 'config'], [/tasks/, 'itTask'], [/bundles/, 'bundle'], [/notifications/, 'notification'], [/actions/, 'action'], [/admin|chat/, 'user']];
    return m.find(([re]) => re.test(key))?.[1] ?? null;
  };
  const created: Item[] = [];

  const send: Send = async (req: Req): Promise<Res> => {
    const o = info.get(req.op);
    if (!o) return { status: 404, body: { error: 'Not found' } };
    const row = ROWS[req.op];
    const tenant = String(o.tenant);
    const co = coOf(req.login);
    const forbidden: Res = { status: 403, body: leak === 'forbidden-body' ? { message: 'no' } : { error: 'Forbidden' } };
    const notFound = (i?: Item): Res => ({ status: 404, body: leak === 'notfound-body' ? { message: 'nothing' } : leak === 'id-echo' && i ? { error: 'Not found', email: i.email } : { error: 'Not found' } });
    if (!row) return { status: 500, body: {} };
    if (row.kind === 'none') return { status: 200, body: 'docs' };
    if (row.kind === 'stored') return leak === 'stored-leak' ? { status: 200, body: show(items[0]!) } : { status: 404, body: { error: 'Not found' } };
    if (tenant === 'agent' || row.kind === 'agent') {
      if (leak === 'agent-all') return { status: 200, body: { items: items.map(show) } };
      return { status: 200, body: { items: items.filter((i) => i.co === 'A').map(show) } };
    }
    if (!co) return { status: 401, body: {} };
    const roles = Array.isArray(o.roles) ? (o.roles as string[]) : [];
    if (!rolesOk(req.login, roles)) return forbidden;
    if (row.kind === 'byId') {
      const re = new RegExp(`^${o.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '([^/]+)')}$`);
      const captured = (re.exec(req.path)?.slice(1) ?? []).map((x) => decodeURIComponent(x));
      const item = items.find((i) => captured.includes(i.id));
      if (!item) return notFound();
      if (item.co !== co) {
        if (leak === 'id-200') return { status: 200, body: show(item) };
        if (leak === 'write-through' && req.method !== 'GET') { item.v++; return notFound(); }
        return notFound(item);
      }
      if (req.method !== 'GET') item.v++;
      return { status: 200, body: show(item) };
    }
    if (row.kind === 'list') {
      const kind = kindOfList(req.op);
      let mine = items.filter((i) => i.kind === kind && i.co === co);
      if (leak === 'list-all') mine = items.filter((i) => i.kind === kind);
      if (leak === 'list-query' && req.query['tenantId'] === w.tenantA) mine = items.filter((i) => i.kind === kind && i.co === 'A');
      return { status: 200, body: { items: mine.map(show) } };
    }
    if (row.kind === 'create') {
      const kind = kindOfList(req.op) ?? 'employee';
      const asked = (req.body as { tenantId?: string } | undefined)?.tenantId;
      const owner = leak === 'create-from-body' && asked === w.tenantA ? 'A' : co;
      const item: Item = { id: `new-${created.length}`, kind, co: owner, name: 'TEN04 Walk', email: 'e2e.run-ten04@example.com', v: 0 };
      created.push(item);
      items.push(item);
      return { status: 201, body: { id: item.id } };
    }
    return { status: 200, body: {} };
  };
  void TENANT_A_QUERY; void A_BODY;
  return { send, items };
}
