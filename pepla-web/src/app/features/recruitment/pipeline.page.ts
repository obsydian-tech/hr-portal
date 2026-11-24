import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { BoardPage } from './board.page';
import { PipelineListPage } from './pipeline-list.page';

/** /hire/pipeline: the board of one role, or the list (no role, All roles, or view=list). */
@Component({
  selector: 'app-pipeline-page',
  imports: [BoardPage, PipelineListPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (p().board) { @for (k of [p().key]; track k) { <app-board-page /> } } @else { @for (k of [p().key]; track k) { <app-pipeline-list [role]="p().role" /> } }`,
})
export class PipelinePage {
  private readonly route = inject(ActivatedRoute);
  private readonly q = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly p = computed(() => {
    const m = this.q();
    const raw = m.get('role') ?? '';
    const role = raw === 'all' ? '' : raw;
    const board = !!role && m.get('view') !== 'list';
    return { board, role, key: `${board ? 'b' : 'l'}:${role}` };
  });
}
