/**
 * CHAT-09: Batsi's people list: every page, HR home's order, filters and counts, page words, kept under the size cut.
 * TRIAL BUILD (tests' proof only, not for merge).
 */
import { todayInJohannesburg, todayWritten, writtenDate } from '../shared/due-date.mjs';
import { STEP_WORDS, overdue } from './person.mjs';

const MAX_PAGES = 10;
const MAX_CHARS = 7500;
const STEP_CODE = Object.fromEntries(Object.entries(STEP_WORDS).map(([k, v]) => [v, k]));
const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const nameOf = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ').trim();

/** HR home's orderNewEmployees: from today soonest first, then past most recent first, then no date; same date by name. */
export function homeOrder(people, today) {
  const group = (p) => (!p.start ? 2 : p.start >= today ? 0 : 1);
  return [...people].sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    const byDate = group(a) === 0 ? a.start.localeCompare(b.start) : group(a) === 1 ? b.start.localeCompare(a.start) : 0;
    return byDate || a.name.localeCompare(b.name, 'en');
  });
}

export async function listPeople(args, context, agentGet, now = new Date()) {
  const a = args ?? {};
  const today = todayInJohannesburg(now);
  const rows = [];
  let lastKey;
  let pages = 0;
  let complete = true;
  do {
    const page = await agentGet(`/agent/v1/employees?limit=200${lastKey ? `&lastKey=${encodeURIComponent(lastKey)}` : ''}`);
    pages++;
    rows.push(...(Array.isArray(page?.items) ? page.items : []));
    lastKey = page?.lastKey;
    if (lastKey && pages >= MAX_PAGES) { complete = false; break; }
  } while (lastKey);

  const me = new Set([context?.staffIdClaim, context?.username, context?.sub].filter(Boolean));
  const steps = Array.isArray(a.step) ? a.step.map((w) => STEP_CODE[w]).filter(Boolean) : null;
  const dept = typeof a.department === 'string' && a.department.trim() ? a.department.trim().toLowerCase() : null;
  const from = dayOf(a.starts_from);
  const to = dayOf(a.starts_to);

  let people = rows.map((r) => {
    const stepCode = STEP_WORDS[r.step] ? r.step : null;
    const start = dayOf(r.planned_start_date);
    const due = dayOf(r.documents_due);
    return {
      _step: stepCode, _partner: r.hr_staff_id ?? '', _by: r.created_by ?? '', _at: r.created_at ?? '', _dept: String(r.department ?? '').trim().toLowerCase(),
      name: nameOf(r), department: r.department ?? '', job_title: r.job_title ?? '', step: STEP_WORDS[stepCode] ?? null,
      start, start_written: writtenDate(start), due, due_written: writtenDate(due), documents_overdue: overdue(stepCode, due, today),
      hr_partner: r.hr_staff_name ?? '', employee_id: r.employee_id,
    };
  });
  if (steps && steps.length) people = people.filter((p) => steps.includes(p._step));
  if (dept) people = people.filter((p) => p._dept === dept);
  if (from || to) people = people.filter((p) => p.start && (!from || p.start >= from) && (!to || p.start <= to));
  if (a.no_start_date === true) people = people.filter((p) => !p.start);
  if (a.overdue === true) people = people.filter((p) => p.documents_overdue);
  if (a.hr_partner_is_me === true) people = people.filter((p) => me.has(p._partner));
  if (a.added_by_me === true) people = people.filter((p) => p._by && p._by === context?.staffId);

  if (a.sort === 'added') people.sort((x, y) => String(y._at).localeCompare(String(x._at)));
  else if (a.sort === 'name') people.sort((x, y) => x.name.localeCompare(y.name, 'en'));
  else people = homeOrder(people, today);

  const counts = { Invited: 0, Documents: 0, 'In review': 0, Verified: 0 };
  for (const p of people) if (p.step) counts[p.step]++;
  const limit = Math.max(1, Math.min(20, Number.isFinite(Number(a.limit)) && Number(a.limit) > 0 ? Math.floor(Number(a.limit)) : 20));
  const shownPeople = people.slice(0, limit).map(({ _step, _partner, _by, _at, _dept, ...p }) => p);
  const answer = (list) => ({
    today: todayWritten(now), complete, total_matching: people.length, counts_by_step: counts,
    overdue_count: people.filter((p) => p.documents_overdue).length, shown: list.length, people: list,
  });
  let out = answer(shownPeople);
  while (JSON.stringify(out).length > MAX_CHARS && out.people.length > 0) out = answer(out.people.slice(0, -1));
  return out;
}
