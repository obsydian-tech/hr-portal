import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input } from '@angular/core';
import { PpIcon } from '../core/icon';
import { PpIconTile } from '../core/logo';
import { PpLink } from '../actions/link';
import { SITE_MENU, SITE_MENU_BATSI, SITE_MENU_BATSI_AFTER, SiteMenuList } from './content';

interface Row { list?: SiteMenuList; batsi?: boolean }
let uid = 0;

/**
 * The main links in the header: Product, Ask Batsi, Integrations, Resources and Company. One shared panel opens under the
 * links, slides to the one you point at, resizes to fit and fades its entries in one after another. This is the behaviour
 * the design system's preview script only fakes (scripts/preview/site-header.js, section 2), as the real thing:
 * hover with a grace, click, Enter and Space, arrows, Escape, a click outside, the pointer tilt and the pointer light.
 * It only ever sets class names, attributes and the documented --_ inputs; never a width, height, left or top.
 * Spec: project/components/site/site-menu.md
 */
@Component({
  selector: 'nav[ppSiteMenu]',
  imports: [PpIcon, PpIconTile, PpLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pp-site-menu__morph" aria-hidden="true"></span>
    <span class="pp-site-menu__arrow" aria-hidden="true"></span>
    <ul class="pp-site-menu__list">
      @for (row of rows; track $index) {
        <li class="pp-site-menu__item">
          @if (row.list; as list) {
            <button class="pp-site-menu__trigger" type="button" aria-expanded="false" [attr.aria-controls]="id + list.id">
              <span>{{ list.label }}</span><svg ppIcon="chevron-down" class="pp-site-menu__chevron" />
            </button>
            <div class="pp-site-menu__panel" [class.pp-site-menu__panel--wide]="list.width === 'wide'" [class.pp-site-menu__panel--medium]="list.width === 'medium'" [id]="id + list.id" inert>
              @for (e of list.entries; track e.name) {
                <a class="pp-site-menu__link" [href]="e.href" [style.--_i]="$index">
                  <pp-icon-tile [icon]="e.icon" [tone]="e.tone ?? 'brand'" />
                  <span>
                    <span class="pp-site-menu__name">{{ e.name }}@if (e.soon) {<span class="pp-site-menu__soon">Coming soon</span>}</span>
                    @if (e.hint) { <span class="pp-site-menu__hint">{{ e.hint }}</span> }
                  </span>
                </a>
              }
              @if (list.foot; as foot) {
                <div class="pp-site-menu__foot"><span>{{ foot.text }}</span><a ppLink [href]="foot.href">{{ foot.link }}</a></div>
              }
            </div>
          } @else {
            <a class="pp-site-menu__trigger" [href]="batsi.href"><span>{{ batsi.label }}</span></a>
          }
        </li>
      }
    </ul>
  `,
  host: { class: 'pp-site-menu', 'aria-label': 'Main' },
})
export class PpSiteMenu {
  protected readonly id = `site-menu-${++uid}-`;
  /** A list that starts open (`product`, `integrations`, `resources`, `company`), for kit and gallery frames. It stays until the pointer leaves, Escape or a click outside. */
  readonly openList = input<string>();
  protected readonly batsi = SITE_MENU_BATSI;
  protected readonly rows: Row[] = [
    ...SITE_MENU.slice(0, SITE_MENU_BATSI_AFTER).map((list) => ({ list })),
    { batsi: true },
    ...SITE_MENU.slice(SITE_MENU_BATSI_AFTER).map((list) => ({ list })),
  ];

  constructor() {
    const menu = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const doc = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => this.wire(menu, doc, destroyRef));
  }

  private wire(menu: HTMLElement, doc: Document, destroyRef: DestroyRef): void {
    const win = doc.defaultView;
    if (!win) return;
    const q = <T extends Element = HTMLElement>(s: string, r: ParentNode = menu) => r.querySelector<T>(s);
    const all = (s: string, r: ParentNode = menu) => Array.from(r.querySelectorAll<HTMLElement>(s));
    const morph = q('.pp-site-menu__morph')!;
    const canHover = win.matchMedia('(hover:hover)').matches;
    const still = () => !!menu.closest('[data-site-still]');
    const items = all('.pp-site-menu__item').filter((li) => q('.pp-site-menu__panel', li));
    const parts = (li: HTMLElement) => ({ b: q('.pp-site-menu__trigger', li)!, p: q('.pp-site-menu__panel', li)! });
    let cur: HTMLElement | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const off: (() => void)[] = [];
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => { t.addEventListener(type, fn, opts); off.push(() => t.removeEventListener(type, fn, opts)); };

    const measure = (li: HTMLElement) => {
      const x = parts(li), w = x.p.offsetWidth, h = x.p.offsetHeight;
      const left = Math.max(0, Math.min(x.b.offsetLeft - 8, menu.clientWidth - w));
      return { left, sx: Math.min(1, w / morph.offsetWidth), sy: Math.min(1, h / morph.offsetHeight), ax: x.b.offsetLeft + x.b.offsetWidth / 2 - 6 };
    };
    const place = (li: HTMLElement) => {
      const m = measure(li);
      menu.style.setProperty('--_x', `${m.left}px`); menu.style.setProperty('--_sx', m.sx.toFixed(3));
      menu.style.setProperty('--_sy', m.sy.toFixed(3)); menu.style.setProperty('--_ax', `${m.ax}px`);
    };
    const layout = () => { items.forEach((li) => parts(li).p.style.setProperty('--_x', `${measure(li).left}px`)); if (cur) place(cur); };
    const setOpen = (li: HTMLElement, isOpen: boolean) => {
      const x = parts(li);
      x.p.classList.toggle('pp-site-menu__panel--open', isOpen);
      x.b.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) x.p.removeAttribute('inert'); else x.p.setAttribute('inert', '');
    };
    const open = (li: HTMLElement) => {
      clearTimeout(closeTimer);
      if (cur === li) return;
      const from = cur ? items.indexOf(cur) : -1, to = items.indexOf(li), dir = from < 0 ? 0 : (to > from ? 1 : -1);
      const first = !cur;
      if (cur) { parts(cur).p.style.setProperty('--_dir', String(-dir)); setOpen(cur, false); }
      parts(li).p.style.setProperty('--_dir', String(dir || 1));
      // The first opening snaps the background under the link instead of sliding in from the corner.
      if (first) { morph.style.transition = 'none'; place(li); void morph.offsetWidth; morph.style.transition = ''; } else place(li);
      void parts(li).p.offsetWidth;
      parts(li).p.style.setProperty('--_dir', '0'); setOpen(li, true);
      cur = li; menu.classList.add('pp-site-menu--open');
    };
    const close = (returnFocus = false) => {
      clearTimeout(closeTimer);
      if (!cur) return;
      const b = parts(cur).b; setOpen(cur, false); cur = null; menu.classList.remove('pp-site-menu--open');
      menu.style.setProperty('--_rx', '0deg'); menu.style.setProperty('--_ry', '0deg');
      if (returnFocus) b.focus();
    };

    layout();
    const start = this.openList();
    if (start) { const li = items.find((x) => parts(x).p.id === this.id + start); if (li) open(li); }
    doc.fonts?.ready.then(layout);
    on(win, 'resize', layout);
    for (const li of items) {
      const x = parts(li);
      on(x.b, 'mouseenter', () => { if (canHover) open(li); });
      on(x.b, 'click', (e: MouseEvent) => {
        if (cur === li && (e.detail > 0 ? !canHover : true)) { close(true); return; }
        open(li);
        if (e.detail === 0) q('.pp-site-menu__link', x.p)?.focus(); // keyboard: move into the list
      });
      on(x.p, 'mouseenter', () => clearTimeout(closeTimer));
      on(x.p, 'click', (e: Event) => { if ((e.target as Element).closest('.pp-site-menu__link, .pp-link')) close(); });
      on(x.p, 'keydown', (e: KeyboardEvent) => {
        const links = all('.pp-site-menu__link', x.p), i = links.indexOf(doc.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); links[Math.min(links.length - 1, i + 1)]?.focus(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); links[Math.max(0, i - 1)]?.focus(); }
      });
    }
    // Moving onto a plain link (Ask Batsi) closes the open list after a short grace.
    for (const li of all('.pp-site-menu__item')) {
      if (!items.includes(li)) on(li, 'mouseenter', () => { if (canHover && cur) closeTimer = setTimeout(() => close(), 120); });
    }
    on(menu, 'mouseleave', () => { if (canHover) closeTimer = setTimeout(() => close(), 220); });

    // Pointer light: a soft light in the open panel drifts to the pointer. It keeps moving under reduced motion; still mode holds it.
    on(menu, 'mousemove', (e: MouseEvent) => {
      if (!cur || !canHover || still()) return;
      const p = parts(cur).p, b = p.getBoundingClientRect();
      if (!b.width) return;
      p.style.setProperty('--_gx', `${(e.clientX - b.left - b.width / 2).toFixed(0)}px`); p.style.setProperty('--_gy', `${(e.clientY - b.top).toFixed(0)}px`);
    });
    // Pointer tilt: the open background, arrow and panel lean up to 1.5deg across and 1.2deg up and down. Mouse only; never under reduced motion or still mode.
    on(menu, 'mousemove', (e: MouseEvent) => {
      if (!cur || !canHover || win.matchMedia('(prefers-reduced-motion: reduce)').matches || still()) return;
      const r = morph.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (y > 0) { menu.style.setProperty('--_ry', `${((x - 0.5) * 3).toFixed(2)}deg`); menu.style.setProperty('--_rx', `${((0.5 - y) * 2.4).toFixed(2)}deg`); }
    });
    on(doc, 'click', (e: Event) => { if (cur && !menu.contains(e.target as Node)) close(); });
    on(doc, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' && cur) close(true); });

    destroyRef.onDestroy(() => { clearTimeout(closeTimer); off.forEach((f) => f()); });
  }
}
