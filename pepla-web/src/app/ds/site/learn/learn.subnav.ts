import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input } from '@angular/core';
import type { LearnTab } from './learn.types';

/**
 * The sub-menu of a Learn more page: "On this page", the page's name (from 1280 wide) and one tab per section. It sticks under the shrunk
 * header; the tab of the section in view is current and a highlight slides under it, placed with `--_x` and `--_sx` so only a transform moves;
 * a tap on a tab scrolls the section's top to just under the header and the sub-menu. The tab strip scrolls sideways when it does not fit.
 * The sections are looked up inside the page the sub-menu is in (a gallery holds a desktop and a phone page with the same ids).
 * It is the kit's `site-pages.js`, step for step. Browser only. Spec: SITE-08, kit: project/components/site/site-subnav.md
 */
@Component({
  selector: 'nav[ppSiteLearnSubnav]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-subnav__bar"><p class="pp-site-subnav__title">{{ name() }}</p>
<div class="pp-site-subnav__tabs"><span class="pp-site-subnav__pill" aria-hidden="true"></span>@for (t of tabs(); track t.id) {<a class="pp-site-subnav__link" [attr.href]="'#' + t.id">{{ t.label }}</a>}</div>
</div>
  `,
  host: { class: 'pp-site-subnav', 'aria-label': 'On this page' },
})
export class PpSiteLearnSubnav {
  private readonly nav = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  /** The page's name, shown beside the tabs from 1280 wide. */
  readonly name = input.required<string>();
  readonly tabs = input.required<readonly LearnTab[]>();

  constructor() {
    const off: Array<() => void> = [];
    inject(DestroyRef).onDestroy(() => off.forEach((f) => f()));
    afterNextRender(() => {
      const win = this.doc.defaultView;
      if (!win) return;
      const nav = this.nav;
      const root = nav.parentElement ?? this.doc.body;
      const tabs = nav.querySelector<HTMLElement>('.pp-site-subnav__tabs')!, pill = nav.querySelector<HTMLElement>('.pp-site-subnav__pill')!;
      const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('.pp-site-subnav__link'));
      const reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const secs = links.map((a) => root.querySelector<HTMLElement>(`[id="${a.getAttribute('href')!.slice(1)}"]`));
      let cur: HTMLAnchorElement | null = null;
      const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => { win.addEventListener(type, fn, opts); off.push(() => win.removeEventListener(type, fn)); };

      const mark = (a: HTMLAnchorElement | null, snap: boolean) => {
        if (a === cur) return;
        cur = a;
        links.forEach((l) => { if (l === a) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current'); });
        nav.classList.toggle('pp-site-subnav--active', !!a);
        if (!a) return;
        if (snap) pill.style.transition = 'none';
        pill.style.setProperty('--_x', `${a.offsetLeft}px`);
        pill.style.setProperty('--_sx', (a.offsetWidth / pill.offsetWidth).toFixed(3));
        if (snap) { void pill.offsetWidth; pill.style.transition = ''; }
        const l = a.offsetLeft - tabs.scrollLeft;
        if (l < 0 || l + a.offsetWidth > tabs.clientWidth) tabs.scrollTo({ left: Math.max(0, a.offsetLeft - 24), behavior: reduce ? 'auto' : 'smooth' });
      };
      const check = () => {
        const y = nav.getBoundingClientRect().bottom + 24;
        let hit: HTMLAnchorElement | null = null;
        secs.forEach((s, i) => { if (!s) return; const r = s.getBoundingClientRect(); if (r.top <= y && r.bottom > y) hit = links[i]!; });
        mark(hit, cur === null);
      };
      on('scroll', check, { passive: true });
      on('resize', () => { const a = cur; cur = null; mark(a, true); });
      check();
      // The tab widths change when the web fonts arrive (a slow connection loads them after this runs): place the highlight again whenever a tab's width changes.
      if (typeof win.ResizeObserver === 'function') {
        const ro = new win.ResizeObserver(() => { const a = cur; cur = null; mark(a, true); });
        links.forEach((l) => ro.observe(l));
        off.push(() => ro.disconnect());
      }

      links.forEach((a, i) => {
        const click = (e: Event) => {
          e.preventDefault();
          const s = secs[i];
          if (!s) return;
          const top = () => Math.max(0, s.getBoundingClientRect().top + win.scrollY - nav.offsetHeight - (parseFloat(win.getComputedStyle(nav).top) || 0));
          win.scrollTo({ top: top(), behavior: reduce ? 'auto' : 'smooth' });
          // Demos above can change height while the page moves: land exactly once it stops.
          let t: ReturnType<typeof setTimeout>;
          const settle = () => {
            clearTimeout(t);
            t = setTimeout(() => { win.removeEventListener('scroll', settle); if (Math.abs(top() - win.scrollY) > 4) win.scrollTo({ top: top() }); }, 180);
          };
          win.addEventListener('scroll', settle, { passive: true });
        };
        a.addEventListener('click', click);
        off.push(() => a.removeEventListener('click', click));
      });
    });
  }
}
