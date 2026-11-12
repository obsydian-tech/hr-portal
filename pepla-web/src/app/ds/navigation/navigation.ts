import { ChangeDetectionStrategy, Component, ElementRef, InjectionToken, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { uid } from '../util';

export interface Crumb { label: string; link: string; }

/**
 * Where this page sits. Not on top-level pages. Paths deeper than 4 show the first level, a "more"
 * button and the last 2; the button expands the trail in place. Spec: navigation/breadcrumbs.md
 */
@Component({
  selector: 'pp-breadcrumbs',
  imports: [RouterLink, PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pp-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        @for (c of shown(); track $index) {
          @if (c) { <li class="pp-breadcrumbs__item"><a [routerLink]="c.link">{{ c.label }}</a></li> }
          @else {
            <li class="pp-breadcrumbs__item"><button class="pp-breadcrumbs__more" type="button" [attr.aria-label]="'Show ' + hidden() + ' more levels'" (click)="expanded.set(true)"><svg ppIcon="ellipsis" /></button></li>
          }
        }
      </ol>
    </nav>
  `,
})
export class PpBreadcrumbs {
  readonly items = input.required<Crumb[]>();
  protected readonly expanded = signal(false);
  protected readonly hidden = computed(() => this.items().length - 3);
  /** null stands for the "more" button. */
  protected readonly shown = computed<(Crumb | null)[]>(() => {
    const all = this.items();
    return all.length > 4 && !this.expanded() ? [all[0], null, ...all.slice(-2)] : all;
  });
}

/** Set inside a page header, so its tabs sit at the header's foot with no panel of their own. */
const PP_IN_PAGE_HEADER = new InjectionToken<boolean>('PP_IN_PAGE_HEADER');

export interface HeaderFact { icon: IconName; text: string; }

/**
 * The top of every page: breadcrumbs, the title, one line of facts, at most two buttons (more go in a
 * "More actions" menu), and tabs. One status at most (Calm rule 6).
 * ```html
 * <pp-page-header heading="Thandeka Dlamini" [breadcrumbs]="crumbs" [facts]="facts">
 *   <pp-page-header-actions>…</pp-page-header-actions>
 *   <pp-tabs …/>
 * </pp-page-header>
 * ```
 * Spec: navigation/page-header.md
 */
@Component({
  selector: 'pp-page-header',
  imports: [PpIcon, PpBreadcrumbs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (breadcrumbs().length) { <pp-breadcrumbs [items]="breadcrumbs()" /> }
    <div class="pp-page-header__main">
      <div class="pp-page-header__text">
        <h1 class="pp-page-header__title">{{ heading() }}<ng-content select="pp-lozenge" /></h1>
        @if (description()) { <p class="pp-page-header__description">{{ description() }}</p> }
        @if (facts().length) {
          <p class="pp-page-header__meta">@for (f of facts(); track f.text) {<span><svg [ppIcon]="f.icon" />{{ f.text }}</span>}</p>
        }
      </div>
      <ng-content select="pp-page-header-actions" />
    </div>
    <ng-content select="pp-tabs" />
  `,
  providers: [{ provide: PP_IN_PAGE_HEADER, useValue: true }],
  host: { class: 'pp-page-header' },
})
export class PpPageHeader {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly breadcrumbs = input<Crumb[]>([]);
  readonly facts = input<HeaderFact[]>([]);
}

@Component({ selector: 'pp-page-header-actions', template: '<ng-content />', host: { class: 'pp-page-header__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpPageHeaderActions {}

export interface Tab {
  id: string;
  label: string;
  count?: number;
  /** All tabs have an icon, or none do. */
  icon?: IconName;
  /** No permission: shown with a lock, still focusable, never selected. Say who can give access nearby. */
  locked?: boolean;
}

/**
 * Keeps a view's choice in the address (`?tab=interviews`, `?page=2`), so the view can be shared and
 * Back works. Off when the screen has no router (the gallery) or no `urlParam`.
 */
function urlSync(param: () => string | undefined, value: { set(v: never): void }, parse: (v: string) => unknown) {
  const router = inject(Router, { optional: true });
  const route = inject(ActivatedRoute, { optional: true });
  // Follows the address, so Back and Forward move the view too.
  const query = route ? toSignal(route.queryParamMap) : null;
  effect(() => {
    const p = param();
    const v = p ? query?.()?.get(p) : null;
    if (v != null) untracked(() => value.set(parse(v) as never));
  });
  return (v: string | number) => {
    const p = param();
    if (p && router && route) void router.navigate([], { relativeTo: route, queryParams: { [p]: v }, queryParamsHandling: 'merge' });
  };
}

/**
 * Views of the same thing. Arrow keys move between tabs. The selected tab's content goes inside.
 * ```html
 * <pp-tabs label="Kagiso Molefe" [tabs]="tabs" [(selected)]="tab" urlParam="tab">
 *   @switch (tab()) { @case ('cv') { … } }
 * </pp-tabs>
 * ```
 * `[panel]="false"` when the tabs only switch what the page shows below them.
 * Spec: navigation/tabs.md
 */
@Component({
  selector: 'pp-tabs',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-tabs__list" role="tablist" [attr.aria-label]="label()" (keydown)="keys($event)">
      @for (t of tabs(); track t.id) {
        <button class="pp-tabs__tab" role="tab" type="button" [id]="id + '-' + t.id" [attr.aria-selected]="t.id === selected()"
                [attr.aria-controls]="panel() && !inHeader ? id + '-panel' : null" [attr.aria-disabled]="t.locked ? 'true' : null"
                [attr.tabindex]="t.id === selected() ? null : -1" (click)="pick(t)">
          @if (t.locked) {<svg ppIcon="lock" />} @else if (t.icon) {<svg [ppIcon]="t.icon" />}{{ t.label }}@if (t.count) {<span class="pp-tabs__count">{{ t.count }}</span>}
        </button>
      }
    </div>
    @if (panel() && !inHeader) {
      <div class="pp-tabs__panel" role="tabpanel" [id]="id + '-panel'" [attr.aria-labelledby]="id + '-' + selected()" tabindex="0"><ng-content /></div>
    }
  `,
  host: { class: 'pp-tabs', '[class.pp-page-header__tabs]': 'inHeader' },
})
export class PpTabs {
  /** In a page header the tabs switch what the page shows below the header, so they have no panel. */
  protected readonly inHeader = inject(PP_IN_PAGE_HEADER, { optional: true }) ?? false;
  readonly label = input.required<string>();
  readonly tabs = input.required<Tab[]>();
  readonly selected = model.required<string>();
  readonly panel = input(true);
  /** The query parameter that holds the tab, such as "tab". */
  readonly urlParam = input<string>();
  protected readonly id = uid('pp-tabs');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly toUrl = urlSync(() => this.urlParam(), this.selected, (v) => v);
  protected pick(t: Tab) {
    if (t.locked) return;
    this.selected.set(t.id);
    this.toUrl(t.id);
  }
  protected keys(e: KeyboardEvent) {
    const tabs = this.tabs();
    const i = tabs.findIndex((t) => t.id === this.selected());
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -2;
    if (to === -2) return;
    e.preventDefault();
    // Arrow keys move focus over every tab, locked ones included (they explain themselves); only open tabs are selected.
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next.locked) this.pick(next);
    queueMicrotask(() => this.host.querySelector<HTMLElement>(`#${this.id}-${next.id}`)?.focus());
  }
}

/**
 * Pages of a long list, with where you are in words. Previous is there but off on the first page, and
 * Next on the last. With `urlParam` the pages are links (`?page=2`), so Back and shared links work.
 * `<pp-pagination noun="people" [total]="132" [pageSize]="20" [(page)]="page" urlParam="page" />`
 * Spec: navigation/pagination.md
 */
@Component({
  selector: 'pp-pagination',
  imports: [PpIcon, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pp-pagination" [attr.aria-label]="label() ?? capital(noun()) + ' pages'">
      <p class="pp-pagination__summary" aria-live="polite">Showing <strong>{{ from() }}–{{ to() }}</strong> of <strong>{{ total() }}</strong> {{ noun() }}</p>
      <ul class="pp-pagination__pages">
        <li><ng-container [ngTemplateOutlet]="pageLink" [ngTemplateOutletContext]="{ p: page() - 1, off: page() <= 1, label: 'Previous page', prev: true }" /></li>
        @for (p of pages(); track $index) {
          @if (p === 0) { <li><span class="pp-pagination__gap" aria-hidden="true"><svg ppIcon="ellipsis" /></span></li> }
          @else { <li><ng-container [ngTemplateOutlet]="pageLink" [ngTemplateOutletContext]="{ p, off: false, label: 'Page ' + p }" /></li> }
        }
        <li><span class="pp-pagination__position">Page {{ page() }} of {{ count() }}</span></li>
        <li><ng-container [ngTemplateOutlet]="pageLink" [ngTemplateOutletContext]="{ p: page() + 1, off: page() >= count(), label: 'Next page', next: true }" /></li>
      </ul>
    </nav>
    <ng-template #pageLink let-p="p" let-off="off" let-label="label" let-prev="prev" let-next="next">
      <ng-template #words>@if (prev) {<svg ppIcon="chevron-left" /><span>Previous</span>} @else if (next) {<span>Next</span><svg ppIcon="chevron-right" />} @else {{{ p }}}</ng-template>
      @if (urlParam() && !off) {
        <a class="pp-pagination__page" [routerLink]="[]" [queryParams]="query(p)" queryParamsHandling="merge" [attr.aria-label]="label"
           [attr.aria-current]="!prev && !next && p === page() ? 'page' : null" (click)="go(p)"><ng-container [ngTemplateOutlet]="words" /></a>
      } @else {
        <button class="pp-pagination__page" type="button" [disabled]="off" [attr.aria-label]="label"
                [attr.aria-current]="!prev && !next && p === page() ? 'page' : null" (click)="go(p)"><ng-container [ngTemplateOutlet]="words" /></button>
      }
    </ng-template>
  `,
})
export class PpPagination {
  readonly total = input.required<number>();
  readonly pageSize = input(20);
  /** What the list holds, plural: "people". */
  readonly noun = input('items');
  /** The navigation's name, if "People pages" doesn't fit. */
  readonly label = input<string>();
  readonly page = model(1);
  /** The query parameter that holds the page, such as "page". Pages become links. */
  readonly urlParam = input<string>();
  readonly changed = output<number>();
  protected readonly count = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly from = computed(() => Math.min(this.total(), (this.page() - 1) * this.pageSize() + 1));
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));
  /** Page numbers with 0 for a gap: 1 … 4 5 6 … 12 */
  protected readonly pages = computed(() => {
    const n = this.count(), p = this.page();
    const keep = new Set([1, n, p - 1, p, p + 1].filter((x) => x >= 1 && x <= n));
    const out: number[] = [];
    [...keep].sort((a, b) => a - b).forEach((x, i, all) => { if (i && x - all[i - 1] > 1) out.push(0); out.push(x); });
    return out;
  });
  constructor() { urlSync(() => this.urlParam(), this.page, (v) => Math.max(1, parseInt(v, 10) || 1)); }
  protected capital(w: string) { return w.charAt(0).toUpperCase() + w.slice(1); }
  protected query(p: number) { return { [this.urlParam()!]: p }; }
  protected go(p: number) { if (p < 1 || p > this.count()) return; this.page.set(p); this.changed.emit(p); }
}
