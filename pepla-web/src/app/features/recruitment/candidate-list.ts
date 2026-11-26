import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, AfterViewInit, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton, PpCell, PpEmptyState, PpLozenge, PpPerson, PpTableDirective, PpTableWrap } from '../../ds';
import type { components } from '../../core/api/openapi';
import { shortDate } from './hire-format';

export type CandidateRow = components['schemas']['CandidateRow'];
export const STAGE: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', NOT_HIRED: 'Not hired' };
const DAY = 86_400_000;
const sast = (ms: number) => { const d = new Date(ms + 2 * 3_600_000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** The stage-time words (REC-UI-02 rule 2 and the decisions in cards/rec-ui-02.md). */
export function stageTime(r: Pick<CandidateRow, 'due_at' | 'sla_status'>, now = Date.now()): { words: string; tone: 'danger' | 'warning' | 'text' } | null {
  if (!r.due_at || !r.sla_status) return null;
  const n = Math.round((sast(Date.parse(r.due_at)) - sast(now)) / DAY);
  if (r.sla_status === 'OVERDUE') return { words: -n >= 1 ? `Overdue by ${days(-n)}` : 'Overdue', tone: 'danger' };
  if (r.sla_status === 'DUE_SOON') return { words: n >= 1 ? `Due in ${days(n)}` : 'Due today', tone: 'warning' };
  return { words: n >= 1 ? `On track, ${days(n)} left` : 'On track', tone: 'text' };
}

/** The one candidate table of Candidates and the Pipeline list (REC-UI-02 rule 2, AC-2). */
@Component({
  selector: 'app-candidate-list',
  imports: [PpButton, PpCell, PpEmptyState, PpLozenge, PpPerson, PpTableDirective, PpTableWrap, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!rows().length) { <pp-empty-state [compact]="true" heading="No one yet" /> }
    <pp-table-wrap><table ppTable [stack]="true"><caption class="pp-visually-hidden">Candidates, most urgent first</caption>
      <thead><tr><th scope="col">Candidate</th><th scope="col">Stage</th><th scope="col">Stage time</th><th scope="col">Applied</th><th scope="col"><span class="pp-visually-hidden">Open</span></th></tr></thead>
      <tbody>
        @for (r of rows(); track r.id) {
          <tr>
            <td ppCell label="Candidate"><pp-person [name]="r.name" [meta]="meta(r)" size="small" /></td>
            <td ppCell label="Stage">{{ stage(r) }}</td>
            <td ppCell label="Stage time">@if (time(r); as t) { @if (t.tone === 'text') { <span class="pp-text pp-text--small pp-text--subtle">{{ t.words }}</span> } @else { <pp-lozenge [status]="t.tone" [icon]="t.tone === 'danger' ? 'clock-alert' : 'clock'">{{ t.words }}</pp-lozenge> } }</td>
            <td ppCell label="Applied">{{ r.applied_at ? date(r.applied_at) : '' }}</td>
            <td ppCell="actions"><a ppButton appearance="subtle" size="small" [iconOnly]="true" icon="chevron-right" [routerLink]="['/hire/candidates', r.id]" [attr.aria-label]="'Open ' + r.name"></a></td>
          </tr>
        }
      </tbody></table></pp-table-wrap>
    <div #end></div>`,
})
export class CandidateList implements AfterViewInit, OnDestroy {
  readonly rows = input.required<CandidateRow[]>();
  readonly levels = input<Record<string, string> | null>(null);
  readonly more = output<void>();
  private readonly end = viewChild.required<ElementRef<HTMLElement>>('end');
  private io?: IntersectionObserver;
  ngAfterViewInit() { this.io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) this.more.emit(); }); this.io.observe(this.end().nativeElement); }
  ngOnDestroy() { this.io?.disconnect(); }
  protected stage(r: CandidateRow) { return STAGE[r.stage] ?? r.stage; }
  protected time(r: CandidateRow) { return stageTime(r); }
  protected date(s: string) { return shortDate(s); }
  protected meta(r: CandidateRow) {
    const lv = this.levels();
    const level = lv === null ? null : (r.level ? (lv[r.level] ?? r.level) : null);
    return [r.role_title, level].filter(Boolean).join(' · ');
  }
}
