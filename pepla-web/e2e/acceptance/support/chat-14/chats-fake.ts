import type { BrowserContext, Route } from '@playwright/test';

/**
 * CHAT-14 · A stand-in for the Agent API calls the Ask Batsi past-chats screens make, for the no-backend acceptance run.
 * Fake answers only: nothing here calls Bedrock, Textract or any paid AI service (CHAT-14 AC-26).
 *
 * It answers, on any host that is not the app (the contract is CHAT-02's, D-8, and CHAT-14 section 4):
 *
 *   GET    .../v1/chats?nextToken=      { chats: [{ chatId, title, updated }], nextToken? }   the signed-in person's chats, newest first
 *   GET    .../v1/chats/<id>            { chatId, title, created, updated, messages: [{ role, text, at, tools, proposalIds }] }
 *   DELETE .../v1/chats/<id>            { deleted: true }                                      404 for a chat that is not there
 *   DELETE .../v1/chats                 { deleted: true }                                      every chat of the signed-in person
 *   POST   .../agent/v1/ai-chat         { message, chatId?, structuredData, ... }              the question; a question with a `chatId` joins that chat
 *   GET    .../agent/v1/actions/pending { actions: [], count: 0 }
 *
 * Every call needs `Authorization: Bearer <JWT>` (401 otherwise). Whose chats are served is decided from the token alone
 * (its e-mail), never from the path, the query, the body or a header. The fake FLAGS, in `violations`, any call that names
 * a company, a person or an owner in any other way, or that adds a header the app has no business sending; the fixture in
 * chat-14.spec.ts fails the test if the list is not empty (CHAT-14, "The fake checks every chats call ...").
 *
 * Switch off: `on = false` answers 403 to the list, to opening a chat and to a question, and still answers both deletes
 * (CHAT-02 AC-21). Every call is recorded. Held answers wait until `release()`.
 */

export type StoredMessage = { role: 'person' | 'batsi'; text: string; at: string; tools?: string[]; proposalIds?: string[] };
export type StoredChat = { chatId: string; title: string; created: string; updated: string; messages: StoredMessage[] };

/** What a route answers. `ok` is the normal answer. */
export type Mode = 'ok' | 'failed' | 'dropped' | 'offline' | 'notfound' | 'forbidden' | 'nolist' | 'nochatid';
export type RouteName = 'list' | 'list-next' | 'open' | 'delete-one' | 'delete-all' | 'ask';

export type ChatsCall = {
  seq: number;
  route: RouteName | 'pending';
  method: string;
  url: URL;
  path: string;
  authorization: string | null;
  email: string | null;
  body: any;
  /** The chat id in the path, or in the question's body. */
  chatId?: string;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const CHAT_ID = /^[0-9A-Z]{26}$/;
/** Headers a browser call may carry. Anything else is a header the app made up. */
const PLAIN_HEADER = /^(authorization|content-type|accept|accept-encoding|accept-language|user-agent|origin|referer|content-length|cache-control|pragma|priority|connection|host|dnt|sec-[a-z-]+|access-control-[a-z-]+)$/;

export const CHATS_PATH = /\/v1\/chats(\/[^/]+)?$/;
export const ASK_PATH = /\/agent\/v1\/(ai-chat|actions\/pending)$/;

/** A chat id the real API would accept: 26 upper-case letters and digits. */
export const chatId = (n: number): string => `01K${String(n).padStart(23, '0')}`;

export function chat(n: number, title: string, updated: string | Date, messages?: StoredMessage[]): StoredChat {
  const u = typeof updated === 'string' ? updated : updated.toISOString();
  return {
    chatId: chatId(n),
    title,
    created: u,
    updated: u,
    messages: messages ?? [
      { role: 'person', text: title, at: u },
      { role: 'batsi', text: `Answer to: ${title}`, at: u },
    ],
  };
}

type Hold = { route: RouteName; email: string | null; waiters: Array<() => void> };

export class ChatsFake {
  readonly calls: ChatsCall[] = [];
  /** Anything the fake saw that a call may not do (see the top of the file). The test fails if this is not empty. */
  readonly violations: string[] = [];
  /** Ask Batsi switched on for the company. Off: list, open and ask answer 403; both deletes still work. */
  on = true;
  /** How each route answers. Tests set these; `script` goes first. */
  readonly mode: Record<RouteName, Mode> = { list: 'ok', 'list-next': 'ok', open: 'ok', 'delete-one': 'ok', 'delete-all': 'ok', ask: 'ok' };
  /** The next answers of a route, used one by one before `mode`. */
  private readonly queued: Record<RouteName, Mode[]> = { list: [], 'list-next': [], open: [], 'delete-one': [], 'delete-all': [], ask: [] };
  pageSize = 50;
  /** The time the server stamps on a chat that a question creates or joins. Tests keep it equal to the page's clock. */
  now: () => Date = () => new Date();
  /** How a new chat is titled (the first question, cleaned, as the server gives it). Never the typed words unless a test says so. */
  titleFor: (question: string, n: number) => string = (_q, n) => `Saved chat ${n}`;
  /** How the fake answers a question. */
  reply: (question: string, body: any) => string = () => 'Nothing to report.';
  /** Answers sent, in order: the question each was for. */
  readonly answered: string[] = [];

  private readonly stores = new Map<string, StoredChat[]>();
  private readonly holds: Hold[] = [];
  private seq = 0;
  private created = 0;
  /** The id of the chat the last question without a `chatId` created. */
  lastCreated: string | null = null;

  constructor(private readonly appOrigin: string) {}

  // ---------------------------------------------------------------- what tests read and set

  /** The chats stored for this person (by e-mail), newest first. A copy. */
  stored(email: string): StoredChat[] {
    return [...(this.stores.get(email.toLowerCase()) ?? [])].sort(newestFirst);
  }
  seed(email: string, chats: StoredChat[]): void {
    this.stores.set(email.toLowerCase(), chats.map((c) => ({ ...c, messages: [...c.messages] })));
  }
  /** The chat is deleted from behind the page (another tab). */
  deleteBehind(email: string, id: string): void {
    this.stores.set(email.toLowerCase(), (this.stores.get(email.toLowerCase()) ?? []).filter((c) => c.chatId !== id));
  }
  script(route: RouteName, ...modes: Mode[]): void { this.queued[route].push(...modes); }

  of(route: RouteName | 'pending', method?: string): ChatsCall[] { return this.calls.filter((c) => c.route === route && (!method || c.method === method)); }
  /** Every read of the list, first page or a later one. */
  listReads(): ChatsCall[] { return this.calls.filter((c) => c.route === 'list' || c.route === 'list-next'); }
  asks(): ChatsCall[] { return this.of('ask'); }

  /** Calls from now on to this route (and, with an e-mail, from that person) wait for `release()`. The call is recorded when it arrives. */
  hold(route: RouteName, email: string | null = null): void { this.holds.push({ route, email: email?.toLowerCase() ?? null, waiters: [] }); }
  release(route?: RouteName, email?: string): void {
    for (const h of this.holds.splice(0)) {
      if ((!route || h.route === route) && (!email || h.email === email.toLowerCase())) for (const go of h.waiters) go();
      else this.holds.push(h);
    }
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => (CHATS_PATH.test(url.pathname) || ASK_PATH.test(url.pathname)) && url.origin !== this.appOrigin, (route) => this.handle(route));
  }

  // ---------------------------------------------------------------- the routes

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    let body: any = null;
    const raw = request.postData();
    try { body = raw ? JSON.parse(raw) : null; } catch { body = '<<not json>>'; }
    const auth = request.headers()['authorization'] ?? null;
    const email = emailOf(auth);
    const pathId = /\/v1\/chats\/([^/]+)$/.exec(url.pathname)?.[1];
    const name = this.routeOf(request.method(), url);
    const call: ChatsCall = { seq: ++this.seq, route: name, method: request.method(), url, path: url.pathname, authorization: auth, email, body, ...(pathId ? { chatId: decodeURIComponent(pathId) } : {}), };
    if (name === 'ask' && body && typeof body === 'object' && typeof body.chatId === 'string') call.chatId = body.chatId;
    this.calls.push(call);
    this.check(call, request.headers());

    if (!auth || !JWT.test(auth) || !email) return json(route, 401, { message: 'Unauthorized' });

    // Hold, after the call is recorded.
    const held = this.holds.find((h) => h.route === name && (h.email === null || h.email === email));
    if (held) await new Promise<void>((go) => held.waiters.push(go));

    const mode: Mode = this.queued[name === 'pending' ? 'list' : name].shift() ?? (name === 'pending' ? 'ok' : this.mode[name]);
    if (name === 'pending') return json(route, 200, { actions: [], count: 0 });
    if (mode === 'offline') return route.abort('internetdisconnected');
    if (mode === 'dropped') return route.abort('connectionreset');
    if (mode === 'failed') return json(route, name === 'ask' ? 502 : 500, { error: 'Something went wrong', detail: 'upstream said: internal failure 0xDEAD' });
    if (mode === 'forbidden') return json(route, 403, { error: 'Forbidden' });

    const mine = this.stores.get(email) ?? [];

    // ---- the deletes work whether Ask Batsi is on or off
    if (name === 'delete-all') { this.stores.set(email, []); return json(route, 200, { deleted: true }); }
    if (name === 'delete-one') {
      if (mode === 'notfound' || !CHAT_ID.test(call.chatId ?? '') || !mine.some((c) => c.chatId === call.chatId)) return json(route, 404, { error: 'Not found' });
      this.stores.set(email, mine.filter((c) => c.chatId !== call.chatId));
      return json(route, 200, { deleted: true });
    }

    if (!this.on) return json(route, 403, { error: 'Forbidden' });

    if (name === 'list' || name === 'list-next') {
      if (mode === 'nolist') return json(route, 200, { ok: true });
      const all = [...mine].sort(newestFirst);
      const token = url.searchParams.get('nextToken');
      const from = token === null ? 0 : Number(/^p(\d+)$/.exec(token)?.[1] ?? NaN);
      if (!Number.isInteger(from)) return json(route, 400, { error: 'Bad request' });
      const page = all.slice(from, from + this.pageSize);
      const more = from + this.pageSize < all.length;
      return json(route, 200, { chats: page.map(({ chatId: id, title, updated }) => ({ chatId: id, title, updated })), ...(more ? { nextToken: `p${from + this.pageSize}` } : {}) });
    }
    if (name === 'open') {
      const found = mine.find((c) => c.chatId === call.chatId);
      if (mode === 'notfound' || !found) return json(route, 404, { error: 'Not found' });
      return json(route, 200, found);
    }

    // ---- the question
    if (name === 'ask') {
      const question = String(body?.message ?? '');
      const at = this.now().toISOString();
      let target: StoredChat | undefined;
      if (typeof body?.chatId === 'string') {
        target = mine.find((c) => c.chatId === body.chatId);
        if (!target) return json(route, 404, { error: 'Not found' });
      }
      const text = this.reply(question, body);
      this.answered.push(question);
      if (mode === 'nochatid') {
        return json(route, 200, { message: text, toolCallsMade: [], conversationId: 'c-test', structuredData: {}, status: 'COMPLETE', guardrailAction: 'NONE' });
      }
      if (!target) {
        this.created++;
        target = { chatId: `01NEW${String(this.created).padStart(21, '0')}`, title: this.titleFor(question, this.created), created: at, updated: at, messages: [] };
        this.stores.set(email, [target, ...mine]);
        this.lastCreated = target.chatId;
      }
      target.messages.push({ role: 'person', text: question, at }, { role: 'batsi', text, at });
      target.updated = at;
      return json(route, 200, { message: text, toolCallsMade: [], conversationId: 'c-test', chatId: target.chatId, structuredData: {}, status: 'COMPLETE', guardrailAction: 'NONE' });
    }
    return json(route, 404, { error: 'Not found' });
  }

  private routeOf(method: string, url: URL): RouteName | 'pending' {
    if (ASK_PATH.test(url.pathname)) return method === 'GET' ? 'pending' : 'ask';
    const withId = /\/v1\/chats\/[^/]+$/.test(url.pathname);
    if (method === 'DELETE') return withId ? 'delete-one' : 'delete-all';
    if (withId) return 'open';
    return url.searchParams.has('nextToken') ? 'list-next' : 'list';
  }

  /** CHAT-14: the person's ID token is a chats call's only identity. */
  private check(c: ChatsCall, headers: Record<string, string>): void {
    const where = `${c.method} ${c.path}`;
    for (const h of Object.keys(headers)) if (!PLAIN_HEADER.test(h)) this.violations.push(`${where}: a header the app made up: ${h}`);
    for (const h of Object.keys(headers)) if (/company|tenant|staff|owner|person|user-?id|account/i.test(h)) this.violations.push(`${where}: a header names who: ${h}`);
    const keys = [...c.url.searchParams.keys()];
    if (c.route === 'ask' || c.route === 'pending') { if (keys.length) this.violations.push(`${where}: a query on the question route: ${keys.join(',')}`); }
    else for (const k of keys) if (k !== 'nextToken') this.violations.push(`${where}: a query other than nextToken: ${k}`);
    if (c.route !== 'ask') {
      if (c.body !== null) this.violations.push(`${where}: a body on a call that takes none`);
    } else if (c.body && typeof c.body === 'object') {
      for (const k of Object.keys(c.body)) if (!['message', 'chatId', 'screenContext'].includes(k)) this.violations.push(`${where}: a body key the question does not take: ${k}`);
      const sc = c.body.screenContext;
      if (sc && typeof sc === 'object') for (const k of Object.keys(sc)) if (!['view', 'employeeId'].includes(k)) this.violations.push(`${where}: a screenContext key the question does not take: ${k}`);
    } else this.violations.push(`${where}: the question body is not a JSON object`);
    if (/@|T#|#S#/.test(decodeURIComponent(c.path))) this.violations.push(`${where}: the path names a person or a company`);
  }
}

const newestFirst = (a: StoredChat, b: StoredChat): number => (a.updated === b.updated ? (a.chatId < b.chatId ? 1 : -1) : a.updated < b.updated ? 1 : -1);

/** The e-mail in the ID token: the only thing the fake uses to know who is asking. */
function emailOf(authorization: string | null): string | null {
  if (!authorization || !JWT.test(authorization)) return null;
  try {
    const payload = JSON.parse(Buffer.from(authorization.split('.')[1]!, 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch { return null; }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
