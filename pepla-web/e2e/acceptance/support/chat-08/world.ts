import { join } from 'node:path';
import { eventOf, settings } from '../chat-02/world';
import {
  CHAT, KEY, NOW, SECRET, agentApi, listItem, listRules, personRules, tablesWith, type AskOpts, type ListPerson, type Out,
} from '../chat-09/world';
import { LAMBDA, runHandler, type Fetch, type FetchRule, type ModelScript, type Run, type Tables } from './harness';

/**
 * CHAT-08: the turns, people and runs of the card's acceptance criteria. Written from
 * /mnt/project-files/ask-batsi-chat/CHAT-08-answer-formats.md (19 Nov 2026, after the independent check). The people, rows and
 * Agent API answers are CHAT-09's (../chat-09/world.ts, locked): this card reads the lookups CHAT-09 builds, so it is tested on them.
 * Today is Thursday 19 Nov 2026, 10:00 in South Africa (CHAT-09's fixed clock).
 */
export { KEY, NOW, SECRET, agentApi, listItem, listRules, personRules, tablesWith };
export type { ListPerson, Out, Run, Tables, FetchRule };

export const CHATS_LAMBDA = join(LAMBDA, 'askBatsiChats', 'index.mjs');
export const ANSWER_FORMAT = join(LAMBDA, 'nalekoAiChat', 'answer-format.mjs');

/** One model message: a sentence, lookups, or both at once. */
export type Turn = { text?: string; tools?: { name: string; input?: Record<string, unknown> }[] };
/** The model answers these messages in turn. A message with lookups and no text is the usual tool call. */
export const turns = (...ts: Turn[]): ModelScript => ({ intent: 'TOOL_REQUIRED', answers: ts as any });
export const look = (name: string, input: Record<string, unknown> = {}): Turn => ({ tools: [{ name, input }] });
export const say = (text: string): Turn => ({ text });
export const show = (input: Record<string, unknown>) => ({ name: 'show_records', input });

const outOf = (run: Run): Out => {
  const text = typeof run.response?.body === 'string' ? run.response.body : '';
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { run, status: run.response?.statusCode, json, text };
};

/** A question from HR person a1 to Batsi (the real chat Lambda), answered by the script and the fake Agent API. */
export function ask(question: string, o: AskOpts & { chatId?: string } = {}): Out {
  const body = { message: question, templateId: 'freeform', screenContext: o.focus ? { view: 'person', employeeId: o.focus } : { view: 'today' }, ...(o.chatId ? { chatId: o.chatId } : {}) };
  const run = runHandler(CHAT, eventOf(o.who ?? 'a1', 'POST /agent/v1/ai-chat', { body, claims: { 'cognito:username': 'user-a1', ...(o.claims ?? {}) } }), {
    tables: o.tables ?? tablesWith([]),
    env: settings('nalekoAiChat', o.env),
    bedrock: o.bedrock,
    fetch: o.fetch,
    now: o.now ?? NOW,
    secrets: { [SECRET]: { AWSCURRENT: KEY } },
  });
  return outOf(run);
}

/** GET /v1/chats/{id} as HR person a1 (the real askBatsiChats Lambda). */
export function openChat(id: string, tables: Tables, who: Parameters<typeof eventOf>[0] = 'a1'): Out {
  return outOf(runHandler(CHATS_LAMBDA, eventOf(who, 'GET /v1/chats/{id}', { path: { id } }), { tables, env: settings('askBatsiChats'), now: NOW }));
}

export const modelCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'bedrock');
export const answerCalls = (run: Run) => modelCalls(run).filter((c) => c.kind === 'answer');
export const httpCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'http');
export const WHAT = (o: Out) => (o.run.error ? `crashed: ${o.run.error.message.slice(0, 300)}` : `status ${o.status}: ${o.text.slice(0, 300)}`);

/** The tool results the model was given, in order (read from the last answer call's messages). */
export function toolResults(run: Run): { tool: string; input: any; text: string; isError: boolean }[] {
  const all = answerCalls(run);
  const msgs: any[] = all[all.length - 1]?.body?.messages ?? [];
  const uses = new Map<string, { name: string; input: any }>();
  const out: { tool: string; input: any; text: string; isError: boolean }[] = [];
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use') uses.set(b.id, { name: b.name, input: b.input });
      if (b.type === 'tool_result') {
        const u = uses.get(b.tool_use_id);
        out.push({ tool: u?.name ?? '?', input: u?.input, text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content), isError: b.is_error === true });
      }
    }
  }
  return out;
}

/** The tools the model was offered (first answer call). */
export const toolsOffered = (run: Run): any[] => answerCalls(run)[0]?.body?.tools ?? [];

// ---------------------------------------------------------------- what an answer shows

export type Block = { kind: string; [k: string]: any };
export const blocksOf = (o: Out): Block[] => (Array.isArray(o.json?.blocks) ? o.json.blocks : []);
export const kindsOf = (o: Out) => blocksOf(o).map((b) => b.kind);
export const tablesOf = (o: Out) => blocksOf(o).filter((b) => b.kind === 'table');
export const chartsOf = (o: Out) => blocksOf(o).filter((b) => b.kind === 'chart');
export const factsOf = (o: Out) => blocksOf(o).filter((b) => b.kind === 'facts');
export const checksBlocksOf = (o: Out) => blocksOf(o).filter((b) => b.kind === 'checks');
/** Records blocks: everything that is not the model's own text. */
export const recordsOf = (o: Out) => blocksOf(o).filter((b) => b.kind !== 'text' && b.kind !== 'list');
/** The text and list blocks as one string (what the person reads of the model's words). */
export const wordsOf = (o: Out) => blocksOf(o).filter((b) => b.kind === 'text' || b.kind === 'list').map((b) => (b.kind === 'text' ? b.text : (b.items ?? []).join('\n'))).join('\n');

/** Every string in the JSON with the key it sits under. */
export function stringsOf(v: unknown, key = ''): { key: string; value: string }[] {
  if (typeof v === 'string') return [{ key, value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => stringsOf(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => stringsOf(x, k));
  return [];
}

/** A table's rows as arrays of cell strings in column order. */
export const rowsOf = (t: Block): string[][] => (t.rows ?? []).map((r: any) => (t.columns ?? []).map((c: any) => r.cells?.[c.key] ?? ''));
export const headersOf = (t: Block): string[] => (t.columns ?? []).map((c: any) => c.label);

// ---------------------------------------------------------------- words (the screens' own, read from their files in the tests)

export const W = {
  people: ['Employee', 'Step', 'Start date', 'HR partner'],
  notSet: 'Not set',
  notAssigned: 'Not assigned',
  byStep: 'People by step',
  byDepartment: 'People by department',
  other: 'Other',
  byRisk: 'People by risk check',
  showing: (shown: number, total: number) => `Showing ${shown} of ${total}.`,
  due: 'Documents due',
  facts: { department: 'Department', job: 'Job title', step: 'Step', start: 'Start date', partner: 'HR partner', due: 'Documents due', risk: 'Risk check' },
  documents: ['Employee', 'Document', 'Check'],
} as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** People with UUID ids (the dev ids are UUIDs; CHAT-09's TODAY_PEOPLE use short ids). */
export const uuidOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A list answer for these people as the Agent API answers it (CHAT-09's listRules). */
export const listApi = (people: ListPerson[], extra: FetchRule[] = []): Fetch => agentApi([...extra, ...listRules(people)]);
