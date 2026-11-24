import { Injectable, inject, signal } from '@angular/core';
import { HireApi, optionsOf, type HireCounts, type HireRole } from './hire-api';
import type { CandidateRow } from './candidate-list';

/** The list's state and its reads, for both list pages (REC-UI-02 rule 2). */
@Injectable()
export class ListState {
  private readonly api = inject(HireApi);
  readonly rows = signal<CandidateRow[]>([]);
  readonly counts = signal<HireCounts>({ all: 0, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 });
  readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  readonly levels = signal<Record<string, string> | null>(null);
  readonly roles = signal<HireRole[]>([]);
  tab = 'all'; search = ''; role = ''; stage = '';
  private token: string | null = null;
  private asked = new Set<string>();
  private gen = 0;

  async init() {
    const [opts, roles] = await Promise.all([this.api.call('GET', '/v1/roles/options').then(optionsOf), this.api.call<{ roles: HireRole[] }>('GET', '/v1/roles')]);
    this.levels.set(opts ? Object.fromEntries(opts.levels.map((l) => [l.key, l.label])) : null);
    this.roles.set(roles?.status === 200 ? roles.body.roles : []);
  }

  private query(token?: string) {
    const q = new URLSearchParams({ limit: '100' });
    if (this.role && this.role !== 'all') q.set('role_id', this.role);
    if (this.stage) q.set('stage', this.stage);
    if (this.tab === 'overdue') q.set('sla_status', 'OVERDUE'); else if (this.tab === 'due_soon') q.set('sla_status', 'DUE_SOON'); else if (this.tab === 'mine') q.set('mine', 'true');
    const s = this.search.trim().slice(0, 100).trim();
    if (s) q.set('search', s);
    if (token) q.set('nextToken', token);
    return q;
  }

  async load() {
    const g = ++this.gen;
    this.token = null; this.asked.clear();
    this.status.set('loading');
    const r = await this.api.call<{ candidates: CandidateRow[]; counts: HireCounts; nextToken?: string }>('GET', `/v1/candidates?${this.query()}`);
    if (g !== this.gen) return;
    if (!r || r.status !== 200) { this.rows.set([]); return this.status.set('failed'); }
    this.rows.set(r.body.candidates); this.counts.set(r.body.counts); this.token = r.body.nextToken ?? null;
    this.status.set('ready');
  }

  async more() {
    const t = this.token;
    if (!t || this.asked.has(t) || this.status() !== 'ready') return;
    this.asked.add(t);
    const g = this.gen;
    const r = await this.api.call<{ candidates: CandidateRow[]; nextToken?: string }>('GET', `/v1/candidates?${this.query(t)}`);
    if (g !== this.gen || !r || r.status !== 200) return;
    this.rows.update((x) => [...x, ...r.body.candidates]);
    this.token = r.body.nextToken ?? null;
  }
}
