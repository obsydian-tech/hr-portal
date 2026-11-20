/**
 * CHAT-08: what a Batsi answer is drawn from. `blocks` come from the chat Lambda; an answer without them (an old answer, a cached one,
 * a chat stored before CHAT-08) is split here by the same small parser the Lambda uses (lambda/nalekoAiChat/answer-format.mjs), so no
 * Markdown mark is ever shown. Everything is drawn with text binding only.
 */
export type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'facts'; title?: string; items: { label: string; value: string }[] }
  | { kind: 'checks'; items: { label: string; result: string }[] }
  | { kind: 'table'; title?: string; columns: { key: string; label: string; num?: boolean }[]; rows: { cells: Record<string, string>; personId?: string }[]; more?: string }
  | { kind: 'chart'; title: string; type: 'bar'; bars: { label: string; value: number }[] };

export const PERSON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['text', 'list', 'facts', 'checks', 'table', 'chart'];

/** The blocks the screen can draw; an unknown kind is skipped. */
export function knownBlocks(blocks: unknown): AnswerBlock[] {
  return (Array.isArray(blocks) ? blocks : []).filter((b): b is AnswerBlock => !!b && typeof b === 'object' && KINDS.includes((b as { kind?: string }).kind ?? ''));
}

const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*\*|__/g, '').replace(/`/g, '').replace(/^#{1,6}\s+/, '').trim();
const isPipe = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const pipeCells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => strip(c));

/** An answer's text as paragraphs, lists and (a model's own pipe table) a table. */
export function parseAnswerText(text: string): AnswerBlock[] {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: AnswerBlock[] = [];
  let list: { kind: 'list'; ordered: boolean; items: string[] } | null = null;
  const endList = () => { if (list) out.push(list); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isPipe(line)) {
      endList();
      const table: string[][] = [];
      while (i < lines.length && (isPipe(lines[i]!) || isRule(lines[i]!))) { if (!isRule(lines[i]!)) table.push(pipeCells(lines[i]!)); i++; }
      i--;
      if (table.length >= 2) {
        const [head, ...body] = table;
        const columns = head!.slice(0, 5).map((label, n) => ({ key: `c${n}`, label }));
        out.push({ kind: 'table', columns, rows: body.map((r) => ({ cells: Object.fromEntries(columns.map((c, n) => [c.key, r[n] ?? ''])) })) });
      }
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered && !bullet;
      if (list && (list as { ordered: boolean }).ordered !== ordered) endList();
      list ??= { kind: 'list', ordered, items: [] };
      const item = strip((bullet ?? numbered)![1]!);
      if (item) (list as { items: string[] }).items.push(item);
      continue;
    }
    endList();
    const t = strip(line);
    if (t) out.push({ kind: 'text', text: t });
  }
  endList();
  return out;
}
