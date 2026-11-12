import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';

export interface LogFilter { value: string; label: string; count: number; }

/**
 * What Batsi did, with filters by outcome. Put a `pp-timeline` inside whose events carry an `outcome`.
 * `<pp-agent-log [filters]="filters" [(selected)]="show" [hasMore]="true" (more)="older()"><pp-timeline …/></pp-agent-log>`
 * Spec: agent/agent-activity-log.md
 */
@Component({
  selector: 'pp-agent-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (filters().length) {
      <div class="pp-agent-log__filters" role="group" [attr.aria-label]="filtersLabel()">
        @for (f of filters(); track f.value) {
          <button class="pp-button pp-button--default pp-button--small" type="button" [attr.aria-pressed]="selected() === f.value" (click)="selected.set(f.value)">{{ f.label }}<span class="pp-agent-log__count">{{ f.count }}</span></button>
        }
      </div>
    }
    <ng-content />
    @if (hasMore()) { <div><button class="pp-button pp-button--subtle pp-button--small" type="button" (click)="more.emit()">Show older</button></div> }
  `,
  host: { class: 'pp-agent-log' },
})
export class PpAgentLog {
  readonly filters = input<LogFilter[]>([]);
  readonly filtersLabel = input('Show');
  readonly selected = model<string>('all');
  readonly hasMore = input(false);
  readonly more = output<void>();
}
