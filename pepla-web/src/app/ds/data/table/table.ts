// Long lists only: rows render as you scroll (CDK virtual scroll on the page's own scroll) and the
// next page loads before you reach the end. Short tables are a plain <table ppTable>. Spec: data/table.md
import { ChangeDetectionStrategy, Component, ElementRef, TemplateRef, contentChild, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { PpOverflowRegion } from '../overflow-region';
import { ScrollingModule } from '@angular/cdk/scrolling';

export interface Column { key: string; label: string; num?: boolean; }
export interface PageRequest { first: number; rows: number; }

/**
 * ```html
 * <pp-table caption="Candidates" [columns]="cols" [rows]="loaded()" [total]="total()" (load)="fetch($event)">
 *   <ng-template #row let-r><td ppCell label="Name">{{ r.name }}</td>…</ng-template>
 * </pp-table>
 * ```
 * `rows` grows as pages arrive; `(load)` asks for the next one.
 */
@Component({
  selector: 'pp-table',
  imports: [ScrollingModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #head>
      <caption>{{ caption() }}</caption>
      <thead><tr>@for (c of columns(); track c.key) {<th scope="col" [class.pp-table__num]="c.num">{{ c.label }}</th>}</tr></thead>
    </ng-template>
    <ng-template #nothing>
      @if (!rows().length && !loading()) { <tr><td class="pp-table__empty" [attr.colspan]="columns().length">{{ empty() }}</td></tr> }
    </ng-template>
    @if (phone()) {
      <!-- Phone: rows stack as cards of different heights, so every loaded row renders and the next page
           loads as the end comes near. Virtual scroll needs rows of one height. -->
      <table class="pp-table pp-table--stack" [attr.aria-rowcount]="total() + 1" [attr.aria-busy]="loading() ? 'true' : null">
        <ng-container [ngTemplateOutlet]="head" />
        <tbody>
          @for (r of rows(); track $index; let i = $index) {
            <tr [attr.aria-rowindex]="i + 2"><ng-container [ngTemplateOutlet]="row()!" [ngTemplateOutletContext]="{ $implicit: r }" /></tr>
          }
          <ng-container [ngTemplateOutlet]="nothing" />
        </tbody>
      </table>
      <div #end aria-hidden="true"></div>
    } @else {
      <!-- The spacer counts rows only; the padding makes room for the caption and header, so the wrap never scrolls on its own. -->
      <cdk-virtual-scroll-viewport scrollWindow [itemSize]="rowHeight()" (scrolledIndexChange)="near($event)" [style.padding-bottom.px]="headHeight()">
        <table #virtualTable class="pp-table pp-table--stack" [attr.aria-rowcount]="total() + 1" [attr.aria-busy]="loading() ? 'true' : null">
          <ng-container [ngTemplateOutlet]="head" />
          <tbody>
            <tr *cdkVirtualFor="let r of rows(); let i = index; templateCacheSize: 0" [attr.aria-rowindex]="i + 2">
              <ng-container [ngTemplateOutlet]="row()!" [ngTemplateOutletContext]="{ $implicit: r }" />
            </tr>
            <ng-container [ngTemplateOutlet]="nothing" />
          </tbody>
        </table>
      </cdk-virtual-scroll-viewport>
    }
  `,
  host: { class: 'pp-table-wrap' },
  hostDirectives: [PpOverflowRegion],
})
export class PpLongTable {
  readonly caption = input.required<string>();
  readonly columns = input.required<Column[]>();
  readonly rows = input.required<unknown[]>();
  readonly total = input.required<number>();
  readonly loading = input(false);
  readonly empty = input('Nothing here yet.');
  readonly pageSize = input(50);
  /** Pixels; keep rows one line high so scrolling stays smooth. */
  readonly rowHeight = input(49);
  readonly load = output<PageRequest>();
  protected readonly row = contentChild<TemplateRef<unknown>>('row');

  protected readonly phone = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  private readonly virtualTable = viewChild<ElementRef<HTMLTableElement>>('virtualTable');
  protected readonly headHeight = signal(0);

  constructor() {
    // How tall the caption and header are, which the virtual spacer leaves out.
    effect((cleanup) => {
      const t = this.virtualTable()?.nativeElement;
      if (!t) return;
      const measure = () => this.headHeight.set(t.tBodies[0] ? t.tBodies[0].offsetTop : 0);
      const ro = new ResizeObserver(measure);
      ro.observe(t.tHead ?? t);
      measure();
      cleanup(() => ro.disconnect());
    });
    // Phone: ask for the next page when the end of the list is within a screen of view.
    effect((cleanup) => {
      const el = this.end()?.nativeElement;
      this.rows(); this.loading(); // look again once a page lands: the end may still be in view
      if (!el) return;
      const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) untracked(() => this.near(this.rows().length)); }, { rootMargin: '100% 0px' });
      io.observe(el);
      cleanup(() => io.disconnect());
    });
  }

  protected near(firstVisible: number) {
    const loaded = this.rows().length;
    if (!this.loading() && loaded < this.total() && firstVisible + this.pageSize() / 2 >= loaded - this.pageSize() / 2) {
      this.load.emit({ first: loaded, rows: this.pageSize() });
    }
  }
}
