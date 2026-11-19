import type { BrowserContext, Route } from '@playwright/test';

/**
 * CHAT-06: a stand-in for the Agent API calls the Ask Batsi chat makes, for the no-backend acceptance run (copied in spirit from
 * ../chat-01/chat-fake.ts, which is locked; this one is new so that file is not touched). Fake answers only: nothing here calls Bedrock,
 * Textract or any paid AI service.
 *
 * It answers, on any host that is not the app:
 *   POST .../agent/v1/ai-chat                   `reply(question)`, as nalekoAiChat answers with CHAT-06 (message + proposals)
 *   GET  .../agent/v1/actions/pending           { actions: [], count: 0 }  (the waiting count is CHAT-07's)
 *   POST .../agent/v1/actions/<id>/approve      `approve(body)`: status and JSON, as approveAgentAction answers with CHAT-06
 *   POST .../agent/v1/actions/<id>/reject       `reject(body)`
 * Every call needs `Authorization: Bearer <JWT>` (401 otherwise) and is recorded with its body.
 */

export type Proposal = { actionId: string; type?: string; title: string; draft: string; fields?: Record<string, string>; canApprove: boolean; approver?: { name: string } };
export type Reply = { message: string; proposals?: Proposal[] };
export type Answer = { status: number; json: unknown };
export type Call = { method: string; path: string; authorization: string | null; body: any };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const AGENT = /\/agent\/v1\/(ai-chat|actions\/pending|actions\/[^/]+\/(approve|reject))$/;

export class Chat06Fake {
  readonly calls: Call[] = [];
  reply: (question: string) => Reply = () => ({ message: 'Nothing to report.' });
  approve: (body: any, id: string) => Answer = (_b, id) => ({ status: 200, json: { status: 'APPROVED', action_id: id, run_status: 'RAN' } });
  reject: (body: any, id: string) => Answer = (_b, id) => ({ status: 200, json: { status: 'REJECTED', action_id: id } });
  /** Holds the next decision until `release()`, so a test can see the Working state. */
  hold = false;
  private held: Array<() => void> = [];

  constructor(private readonly appOrigin: string) {}

  decisions(kind: 'approve' | 'reject'): Call[] { return this.calls.filter((c) => c.method === 'POST' && c.path.endsWith(`/${kind}`)); }
  release(): void { this.hold = false; for (const go of this.held.splice(0)) go(); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => AGENT.test(url.pathname) && url.origin !== this.appOrigin, (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body: any = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = '<<not json>>'; }
    this.calls.push({ method: request.method(), path: url.pathname, authorization: request.headers()['authorization'] ?? null, body });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });
    if (request.method() === 'GET') return json(route, 200, { actions: [], count: 0 });
    const decision = /\/actions\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
    if (decision) {
      if (this.hold) await new Promise<void>((go) => this.held.push(go));
      const id = decodeURIComponent(decision[1]!);
      const a = decision[2] === 'approve' ? this.approve(body, id) : this.reject(body, id);
      return json(route, a.status, a.json);
    }
    const r = this.reply(String(body?.message ?? ''));
    return json(route, 200, {
      message: r.message,
      toolCallsMade: [],
      chatId: '01CHAT06SCREEN000000000001',
      conversationId: '01CHAT06SCREEN000000000001',
      structuredData: {},
      status: r.proposals?.length ? 'PENDING_APPROVAL' : 'COMPLETE',
      ...(r.proposals?.length ? { proposals: r.proposals } : {}),
      guardrailAction: 'NONE',
    });
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
