import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for the Agent API calls the Ask Batsi chat makes (CHAT-01), for the no-backend acceptance run.
 * Fake answers only: nothing here calls Bedrock, Textract or any paid AI service (the card's AC-17).
 *
 * It answers, on any host that is not the app, these calls (the contract is in cards/chat-01.md):
 *
 *   POST .../agent/v1/ai-chat                      the question; answered by `reply(question)`
 *   GET  .../agent/v1/actions/pending              { actions: [...], count }   what waits for this person
 *   POST .../agent/v1/actions/<id>/approve         { status: 'APPROVED', actionId }
 *   POST .../agent/v1/actions/<id>/reject          { status: 'REJECTED', actionId }
 *
 * Every call needs `Authorization: Bearer <JWT>` (401 otherwise). Every call is recorded. A body never carries the
 * company (tenant) of the caller: the tests read `calls` to check that.
 */

export type ChatCheck = { label: string; result: string };
export type ChatProposal = { actionId: string; title: string; draft: string; canApprove: boolean; approver?: { name: string } };
export type ChatReply = {
  message: string;
  checks?: ChatCheck[];
  proposals?: ChatProposal[];
  /** Added to `structuredData` besides `checks`. */
  extra?: Record<string, unknown>;
};

/** What the question got: a good answer, or one of the failing answers the card names. */
export type ChatMode = 'ok' | 'forbidden' | 'limit' | 'failed' | 'offline' | 'hold';

export type ChatCall = { method: string; url: URL; authorization: string | null; body: any; path: string };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
export const AGENT = /\/agent\/v1\/(ai-chat|actions\/pending|actions\/[^/]+\/(approve|reject))$/;

/** The words (approved 18 Nov 2026, words.json) the fake's answers use. */
export const SAID = {
  ready: 'Four of five checks are complete.',
  outside: 'I can only help with HR work. I do not give salary benchmarks, employment law advice or individual performance ratings.',
};
export const ROWS: ChatCheck[] = [
  { label: 'ID document', result: 'Matches' },
  { label: 'Bank letter', result: 'Matches' },
  { label: 'Tax number', result: 'Captured' },
  { label: 'Contract', result: 'Signed' },
  { label: 'UIF reference number', result: 'Missing' },
];

export class ChatFake {
  readonly calls: ChatCall[] = [];
  mode: ChatMode = 'ok';
  /** Seconds the hourly-limit answer says are left. */
  retryAfter = 720;
  /** Waiting for this person, as GET actions/pending answers them. */
  pending: Array<{ actionId: string; title: string }> = [];
  /** How the fake answers a question. Tests replace it. */
  reply: (question: string, body: any) => ChatReply = () => ({ message: 'Nothing to report.' });
  private held: Array<() => void> = [];
  /** Answers sent, in order: the question each was for. */
  readonly answered: string[] = [];

  constructor(private readonly appOrigin: string) {}

  chats(): ChatCall[] { return this.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/ai-chat')); }
  decisions(kind: 'approve' | 'reject'): ChatCall[] { return this.calls.filter((c) => c.method === 'POST' && c.path.endsWith(`/${kind}`)); }
  pendingReads(): ChatCall[] { return this.calls.filter((c) => c.method === 'GET'); }

  /** Lets every held question answer, in the mode it is then in ('ok' unless changed). */
  release(): void {
    if (this.mode === 'hold') this.mode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => AGENT.test(url.pathname) && url.origin !== this.appOrigin, (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body: any = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = '<<not json>>'; }
    this.calls.push({ method: request.method(), url, authorization: request.headers()['authorization'] ?? null, body, path: url.pathname });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });

    if (request.method() === 'GET') return json(route, 200, { actions: this.pending, count: this.pending.length });

    const decision = /\/actions\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
    if (decision) {
      const id = decodeURIComponent(decision[1]!);
      this.pending = this.pending.filter((a) => a.actionId !== id);
      return json(route, 200, { status: decision[2] === 'approve' ? 'APPROVED' : 'REJECTED', actionId: id });
    }

    // POST ai-chat
    if (this.mode === 'hold') await new Promise<void>((go) => this.held.push(go));
    if (this.mode === 'offline') return route.abort('internetdisconnected');
    if (this.mode === 'forbidden') return json(route, 403, { error: 'Forbidden' });
    if (this.mode === 'failed') return json(route, 502, { error: 'AI service error', detail: 'upstream said: model unavailable' });
    if (this.mode === 'limit') {
      return route.fulfill({ status: 429, headers: { ...CORS, 'content-type': 'application/json', 'retry-after': String(this.retryAfter) }, body: JSON.stringify({ error: 'Rate limit exceeded. Please try again later.', retryAfter: this.retryAfter }) });
    }
    const question = String(body?.message ?? '');
    const r = this.reply(question, body);
    this.answered.push(question);
    for (const p of r.proposals ?? []) if (p.canApprove) this.pending.push({ actionId: p.actionId, title: p.title });
    return json(route, 200, {
      message: r.message,
      toolCallsMade: [],
      conversationId: 'c-test',
      structuredData: { ...(r.checks ? { checks: r.checks } : {}), ...(r.extra ?? {}) },
      status: r.proposals?.length ? 'PENDING_APPROVAL' : 'COMPLETE',
      ...(r.proposals?.length ? { proposals: r.proposals } : {}),
      guardrailAction: 'NONE',
    });
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
