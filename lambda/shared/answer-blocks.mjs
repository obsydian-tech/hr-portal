/**
 * CHAT-08: the limits every answer block passes, fresh (nalekoAiChat) or read back from a stored chat (askBatsiChats).
 */
import { redactNumbers } from './pii-redact.mjs';
import { writtenDate } from './due-date.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- limits

export const LIMITS = Object.freeze({ blocks: 8, text: 1200, listItems: 20, item: 300, facts: 12, checks: 8, rows: 25, columns: 5, cell: 120, barsMin: 2, barsMax: 8, barMax: 10_000, bytes: 20 * 1024 });
const cut = (s, n) => { const t = String(s ?? ''); return t.length <= n ? t : `${t.slice(0, n - 1)}…`; };
const isoToWords = (s) => String(s).replace(/\b(\d{4}-\d{2}-\d{2})(T[\d:.]+Z?)?\b/g, (m, d) => writtenDate(d) || m);
const clean = (s, n) => cut(redactNumbers(isoToWords(String(s ?? ''))), n);

/** Every block through the limits and the number rule. Unknown kinds and broken blocks are dropped. Used on fresh and stored answers. */
export function limitBlocks(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const c = limitBlock(b);
    if (c) out.push(c);
    if (out.length >= LIMITS.blocks) break;
  }
  return out;
}

export function limitBlock(b) {
  if (!b || typeof b !== 'object') return null;
  switch (b.kind) {
    case 'text': {
      const text = clean(b.text, LIMITS.text);
      return text.trim() ? { kind: 'text', text } : null;
    }
    case 'list': {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, LIMITS.listItems).map((i) => clean(i, LIMITS.item)).filter((i) => i.trim());
      return items.length ? { kind: 'list', ordered: b.ordered === true, items } : null;
    }
    case 'facts': {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, LIMITS.facts)
        .map((i) => ({ label: clean(i?.label, LIMITS.cell), value: clean(i?.value, LIMITS.cell) })).filter((i) => i.label && i.value);
      return items.length ? { kind: 'facts', ...(b.title ? { title: clean(b.title, LIMITS.cell) } : {}), items } : null;
    }
    case 'checks': {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, LIMITS.checks)
        .map((i) => ({ label: clean(i?.label, LIMITS.cell), result: clean(i?.result, LIMITS.cell) })).filter((i) => i.label && i.result);
      return items.length ? { kind: 'checks', items } : null;
    }
    case 'table': {
      const columns = (Array.isArray(b.columns) ? b.columns : []).slice(0, LIMITS.columns)
        .filter((c) => c && typeof c.key === 'string')
        .map((c) => ({ key: String(c.key).slice(0, 40), label: clean(c.label, LIMITS.cell), ...(c.num === true ? { num: true } : {}) }));
      if (!columns.length) return null;
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, LIMITS.rows).map((r) => {
        const cells = {};
        for (const c of columns) cells[c.key] = clean(r?.cells?.[c.key], LIMITS.cell);
        return { cells, ...(typeof r?.personId === 'string' && UUID.test(r.personId) ? { personId: r.personId } : {}) };
      });
      if (!rows.length) return null;
      return { kind: 'table', ...(b.title ? { title: clean(b.title, LIMITS.cell) } : {}), columns, rows, ...(b.more ? { more: clean(b.more, LIMITS.cell) } : {}) };
    }
    case 'chart': {
      if (b.type !== 'bar') return null;
      const bars = (Array.isArray(b.bars) ? b.bars : []).slice(0, LIMITS.barsMax)
        .filter((x) => Number.isInteger(x?.value) && x.value >= 0 && x.value <= LIMITS.barMax)
        .map((x) => ({ label: clean(x.label, LIMITS.cell), value: x.value }));
      if (bars.length < LIMITS.barsMin || bars.every((x) => x.value === 0)) return null;
      return { kind: 'chart', type: 'bar', title: clean(b.title, LIMITS.cell), bars };
    }
    default:
      return null;
  }
}

/** Blocks as stored with a chat: at most 20 KB, over that only the text blocks are kept. */
export function storedBlocks(blocks) {
  const all = limitBlocks(blocks);
  let s = JSON.stringify(all);
  if (Buffer.byteLength(s) <= LIMITS.bytes) return s;
  const texts = [];
  for (const b of all.filter((x) => x.kind === 'text')) {
    if (Buffer.byteLength(JSON.stringify([...texts, b])) > LIMITS.bytes) break;
    texts.push(b);
  }
  return JSON.stringify(texts);
}

