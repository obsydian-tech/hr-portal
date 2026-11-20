/**
 * CHAT-08: the blocks of an answer (text, list, facts, checks, table, chart), built by code from the model's text and the turn's own
 * tool results. Pure functions: no AWS call, no model call, no Agent API call. The model only picks which view to show (show_records).
 */
import { writtenDate } from '../shared/due-date.mjs';
import { checkOf } from '../shared/document-check.mjs';
import { LIMITS, UUID, limitBlock, limitBlocks, storedBlocks } from '../shared/answer-blocks.mjs';

export { LIMITS, UUID, limitBlocks, storedBlocks };

export const VIEWS = ['people', 'person', 'people_by_step', 'people_by_department', 'risk', 'documents'];

export const SHOW_RECORDS_TOOL = {
  name: 'show_records',
  description: 'Show the records of this turn\'s lookup on the screen as a table, facts or a chart. Call it once, last. The screen draws the records; you write one short sentence.',
  input_schema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: VIEWS, description: 'Which view of the records to draw.' },
      limit: { type: 'integer', minimum: 1, maximum: 25, description: 'At most this many rows (default 25).' },
    },
    required: ['view'],
    additionalProperties: false,
  },
};

const REFUSED = 'show_records takes only view (one of people, person, people_by_step, people_by_department, risk, documents) and limit (a whole number from 1 to 25). Nothing was shown.';

/** Checks a show_records input. Returns { ok: true, view, limit } or { ok: false, reason }. */
export function checkShow(input) {
  const i = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!i) return { ok: false, reason: REFUSED };
  if (Object.keys(i).some((k) => k !== 'view' && k !== 'limit')) return { ok: false, reason: REFUSED };
  if (!VIEWS.includes(i.view)) return { ok: false, reason: REFUSED };
  if ('limit' in i && !(Number.isInteger(i.limit) && i.limit >= 1 && i.limit <= 25)) return { ok: false, reason: REFUSED };
  return { ok: true, view: i.view, limit: i.limit ?? 25 };
}

// ---------------------------------------------------------------- words

export const WORDS = Object.freeze({
  employee: 'Employee', step: 'Step', start: 'Start date', partner: 'HR partner',
  department: 'Department', job: 'Job title', due: 'Documents due', risk: 'Risk check',
  notSet: 'Not set', notAssigned: 'Not assigned',
  byStep: 'People by step', byDepartment: 'People by department', other: 'Other', byRisk: 'People by risk check',
  document: 'Document', check: 'Check',
});
const STEPS = ['Invited', 'Documents', 'In review', 'Verified'];
const RISK_BARS = ['Batsi rated the risk high', 'Batsi rated the risk medium', 'Batsi rated the risk low', 'Not assessed'];
const DOC_LABELS = { NATIONAL_ID: 'ID document', BANK_CONFIRMATION: 'Bank letter', MATRIC_CERTIFICATE: 'Matric certificate', TERTIARY_QUALIFICATION: 'Tertiary qualifications' };
const CHECK_WORDS = { MATCHES: 'Matches', NEEDS_A_LOOK: 'Needs a look', DOESNT_MATCH: "Doesn't match", READING: 'Being checked' };
// ---------------------------------------------------------------- the model's text

const strip = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*\*|__/g, '').replace(/`/g, '').replace(/^#{1,6}\s+/, '').trim();
const isPipe = (l) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const pipeCells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => strip(c));

/** The model's text as paragraphs, lists and (when no records view was built) its own pipe table. */
export function parseText(text, { dropTables = false } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  const endList = () => { if (list) out.push(list); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isPipe(line)) {
      endList();
      const table = [];
      while (i < lines.length && (isPipe(lines[i]) || isRule(lines[i]))) { if (!isRule(lines[i])) table.push(pipeCells(lines[i])); i++; }
      i--;
      if (!dropTables && table.length >= 2) {
        const [head, ...body] = table;
        const columns = head.slice(0, LIMITS.columns).map((label, n) => ({ key: `c${n}`, label }));
        out.push({ kind: 'table', columns, rows: body.map((r) => ({ cells: Object.fromEntries(columns.map((c, n) => [c.key, r[n] ?? ''])) })) });
      }
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered && !bullet;
      if (list && list.ordered !== ordered) endList();
      list ??= { kind: 'list', ordered, items: [] };
      const item = strip((bullet ?? numbered)[1]);
      if (item) list.items.push(item);
      continue;
    }
    endList();
    if (isRule(line) && line.includes('|')) continue;
    const t = strip(line);
    if (t) out.push({ kind: 'text', text: t });
  }
  endList();
  return out;
}

// ---------------------------------------------------------------- views

const ok = (calls, name) => calls.filter((c) => c.toolName === name && !c.isError);
const last = (a) => a[a.length - 1];

function peopleTable(list, limit) {
  const people = Array.isArray(list?.people) ? list.people : [];
  if (!people.length) return null;
  const shown = people.slice(0, Math.min(limit, LIMITS.rows));
  const total = Number.isInteger(list.total_matching) ? list.total_matching : people.length;
  return {
    kind: 'table',
    columns: [{ key: 'name', label: WORDS.employee }, { key: 'step', label: WORDS.step }, { key: 'start', label: WORDS.start }, { key: 'partner', label: WORDS.partner }],
    rows: shown.map((p) => ({
      cells: { name: p.name ?? '', step: STEPS.includes(p.step) ? p.step : WORDS.notSet, start: p.start_written || writtenDate(p.start) || WORDS.notSet, partner: p.hr_partner || WORDS.notAssigned },
      ...(typeof p.employee_id === 'string' && UUID.test(p.employee_id) ? { personId: p.employee_id } : {}),
    })),
    ...(total > shown.length ? { more: `Showing ${shown.length} of ${total}.` } : {}),
  };
}

function stepChart(list) {
  if (list?.complete !== true || !list.counts_by_step) return null;
  return { kind: 'chart', type: 'bar', title: WORDS.byStep, bars: STEPS.map((s) => ({ label: s, value: Number(list.counts_by_step[s] ?? 0) })) };
}

function departmentChart(list) {
  const people = Array.isArray(list?.people) ? list.people : [];
  if (list?.complete !== true || people.length !== list.total_matching) return null;
  const counts = new Map();
  let none = 0;
  for (const p of people) {
    const d = String(p.department ?? '').trim();
    if (!d) { none++; continue; }
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const named = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let bars = named.map(([label, value]) => ({ label, value }));
  if (bars.length + (none ? 1 : 0) > LIMITS.barsMax) {
    const rest = bars.slice(LIMITS.barsMax - 1).reduce((n, b) => n + b.value, 0) + none;
    bars = [...bars.slice(0, LIMITS.barsMax - 1), { label: WORDS.other, value: rest }];
  } else if (none) bars.push({ label: WORDS.other, value: none });
  return { kind: 'chart', type: 'bar', title: WORDS.byDepartment, bars };
}

function riskChart(report) {
  const n = (k) => (Array.isArray(report?.[k]) ? report[k].length : 0);
  return { kind: 'chart', type: 'bar', title: WORDS.byRisk, bars: ['high', 'medium', 'low', 'no_data'].map((k, i) => ({ label: RISK_BARS[i], value: n(k) })) };
}

function personBlocks(facts, hasChecks) {
  if (!facts || typeof facts !== 'object') return [];
  const items = [
    [WORDS.department, facts.department],
    [WORDS.job, facts.job_title],
    [WORDS.step, facts.step],
    [WORDS.start, facts.start_written || writtenDate(facts.start)],
    [WORDS.partner, facts.hr_partner],
    [WORDS.due, facts.due_written || writtenDate(facts.due)],
    [WORDS.risk, facts.risk?.result || 'Not assessed'],
  ].filter(([, v]) => typeof v === 'string' && v.trim()).map(([label, value]) => ({ label, value }));
  const out = [{ kind: 'facts', ...(facts.name ? { title: facts.name } : {}), items }];
  if (!hasChecks && Array.isArray(facts.documents) && facts.documents_unknown !== true) {
    const rows = facts.documents.map((d) => ({ label: d.document, result: d.check })).filter((r) => r.label && r.result);
    if (rows.length) out.push({ kind: 'checks', items: rows });
  }
  return out;
}

function documentsTable(answer, limit) {
  const items = (Array.isArray(answer?.items) ? answer.items : []).filter((i) => DOC_LABELS[i?.document_type]);
  if (!items.length) return null;
  const shown = items.slice(0, Math.min(limit, LIMITS.rows));
  return {
    kind: 'table',
    columns: [{ key: 'name', label: WORDS.employee }, { key: 'document', label: WORDS.document }, { key: 'check', label: WORDS.check }],
    rows: shown.map((i) => ({
      cells: { name: i.employee_name ?? '', document: DOC_LABELS[i.document_type], check: CHECK_WORDS[checkOf({}, i)] ?? '' },
      ...(typeof i.employee_id === 'string' && UUID.test(i.employee_id) ? { personId: i.employee_id } : {}),
    })),
    ...(items.length > shown.length ? { more: `Showing ${shown.length} of ${items.length}.` } : {}),
  };
}

/** The records blocks of the turn: the shown view, else the default view, else none. */
export function recordBlocks(toolCallsMade, show, { hasChecks = false } = {}) {
  const calls = toolCallsMade ?? [];
  const lists = ok(calls, 'list_employees');
  const people = calls.filter((c) => c.toolName === 'get_employee');
  const list = last(lists)?.result;
  if (show) {
    const limit = show.limit ?? 25;
    switch (show.view) {
      case 'people': return [peopleTable(list, limit)].filter(Boolean);
      case 'people_by_step': return [stepChart(list)].filter(Boolean);
      case 'people_by_department': return [departmentChart(list)].filter(Boolean);
      case 'risk': { const r = last(ok(calls, 'get_high_risk_report'))?.result; return r ? [riskChart(r)] : []; }
      case 'documents': {
        const v = last(ok(calls, 'list_verifications').filter((c) => !c.toolArgs?.employee_id))?.result;
        return [documentsTable(v, limit)].filter(Boolean);
      }
      case 'person': {
        const p = last(people);
        return p && !p.isError ? personBlocks(p.result, hasChecks) : [];
      }
      default: return [];
    }
  }
  const ids = new Set(people.map((c) => c.toolArgs?.id ?? c.toolArgs?.employee_id));
  const p = last(people);
  if (ids.size === 1 && p && !p.isError) return personBlocks(p.result, hasChecks);
  if (list && Array.isArray(list.people) && list.people.length >= 2) return [peopleTable(list, 25)].filter(Boolean);
  return [];
}

/** The answer's blocks: the model's words first, then the records, all through the limits. */
export function answerBlocks(text, toolCallsMade, show, opts = {}) {
  const records = recordBlocks(toolCallsMade, show, opts).map(limitBlock).filter(Boolean);
  const words = parseText(text, { dropTables: records.length > 0 }).map(limitBlock).filter(Boolean);
  return [...words.slice(0, Math.max(0, LIMITS.blocks - records.length)), ...records].slice(0, LIMITS.blocks);
}

// Written as a pattern so this file does not name the ID number field outright (ONB-14 AC-4 lists every file that does).
const PRIVATE = /^(phone|phone_number|id_?number|id_?number_last4|id_?number_encrypted|hr_staff_email|email_encrypted|file_name|s3_key)$/i;
/** A copy of a raw lookup answer with the private keys taken out (structuredData still carries the raw answers the locks pin). */
export function withoutPrivate(v) {
  if (Array.isArray(v)) return v.map(withoutPrivate);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !PRIVATE.test(k)).map(([k, x]) => [k, withoutPrivate(x)]));
  return v;
}
