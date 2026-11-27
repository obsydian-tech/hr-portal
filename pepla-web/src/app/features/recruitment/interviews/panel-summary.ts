import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PpCard, PpLozenge, PpScorecard, type Criterion } from '../../../ds';
import { INTERVIEW_WORDS as W } from './interview-words';

/** INT-UI-05: one interview's numbers as the page draws them (rule 2). Nothing else of the scores answer is kept. */
export type Summary = { split: boolean; overall: string; decisions: string | null; rows: Criterion[] };

const ORDER = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The summary of the entry for `interviewId`, or null when there is nothing to sum up (rule 1, D5). */
export function summaryOf(interviews: unknown, interviewId: string): Summary | null {
  if (!Array.isArray(interviews)) return null;
  const e = interviews.find((x) => isObj(x) && x['interview_id'] === interviewId);
  if (!isObj(e)) return null;
  if (!num(e['overall']) || !num(e['vote_count']) || e['vote_count'] < 1 || typeof e['split'] !== 'boolean') return null;
  const criteria = e['criteria'];
  if (!Array.isArray(criteria) || !criteria.length || !criteria.every((c) => isObj(c) && typeof c['label'] === 'string')) return null;
  const counts: Record<string, number> = {};
  for (const v of Array.isArray(e['votes']) ? e['votes'] : []) {
    if (!isObj(v) || v['legacy'] === true || typeof v['rating'] !== 'string') continue;
    counts[v['rating']] = (counts[v['rating']] ?? 0) + 1;
  }
  const parts = ORDER.filter((r) => counts[r]).map((r) => `${counts[r]} ${W.ratings[r]}`);
  const rows = (criteria as Array<Record<string, unknown>>).filter((c) => num(c['mean']))
    .map((c) => ({ name: c['label'] as string, score: Math.max(0, Math.min(5, c['mean'] as number)), scoreText: (c['mean'] as number).toFixed(1) }));
  return { split: e['split'], overall: (e['overall'] as number).toFixed(1), decisions: parts.length ? parts.join(' · ') : null, rows };
}

let next = 0;

/** INT-UI-05: the "Panel scores" block (kit screen "Candidate: interview done, panel summary"). */
@Component({
  selector: 'app-panel-summary',
  imports: [PpCard, PpLozenge, PpScorecard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card appearance="sunken" role="group" [attr.aria-labelledby]="hid">
      <div class="pp-stack pp-gap-150">
        <div class="pp-inline pp-gap-100 pp-inline--between">
          <h3 class="pp-text pp-text--strong" [id]="hid">{{ w['heading'] }}</h3>
          @if (summary().split) { <pp-lozenge status="warning" icon="triangle-alert">{{ w['split'] }}</pp-lozenge> }
        </div>
        <pp-scorecard [value]="summary().overall" [outOf]="w['outOf']!" [word]="summary().decisions ?? undefined" [criteria]="summary().rows" [max]="5" [criteriaLabel]="w['criteria']!" />
      </div>
    </pp-card>`,
})
export class PanelSummary {
  readonly summary = input.required<Summary>();
  protected readonly w = W.summary;
  protected readonly hid = `panel-summary-${++next}`;
}
