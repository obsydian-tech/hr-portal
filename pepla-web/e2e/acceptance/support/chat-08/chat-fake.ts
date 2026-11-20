import type { BrowserContext, Route } from '@playwright/test';

/**
 * CHAT-08: a stand-in for the Agent API calls the Ask Batsi chat makes, for the no-backend acceptance run (in the spirit of
 * ../chat-06/chat-fake.ts, which is locked; this one is new so that file is not touched). Fake answers only: nothing here calls Bedrock,
 * Textract or any paid AI service.
 *
 * It answers, on any host that is not the app:
 *   POST .../agent/v1/ai-chat          `reply(question)`, as nalekoAiChat answers with CHAT-08 (message + blocks)
 *   GET  .../agent/v1/actions/pending  { actions: [], count: 0 }
 * Every call needs `Authorization: Bearer <JWT>` (401 otherwise) and is recorded with its body.
 */

export type Reply = { message: string; blocks?: Array<{ kind: string; [k: string]: any }>; checks?: unknown[] };
export type Call = { method: string; path: string; authorization: string | null; body: any };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const AGENT = /\/agent\/v1\/(ai-chat|actions\/pending)$/;

export class Chat08Fake {
  readonly calls: Call[] = [];
  reply: (question: string) => Reply = () => ({ message: 'Nothing to report.' });

  constructor(private readonly appOrigin: string) {}

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
    const r = this.reply(String(body?.message ?? ''));
    return json(route, 200, {
      message: r.message,
      toolCallsMade: [],
      chatId: '01CHAT08SCREEN000000000001',
      conversationId: '01CHAT08SCREEN000000000001',
      structuredData: r.checks ? { checks: r.checks } : {},
      ...(r.blocks ? { blocks: r.blocks } : {}),
      status: 'COMPLETE',
      guardrailAction: 'NONE',
    });
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
