import { DestroyRef, Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * A box that scrolls sideways (a wide table on a phone) becomes a named region a keyboard can reach,
 * but only while it overflows: `tabindex="0"`, `role="region"`, and the table's caption as its name.
 * Used by the table wraps. Spec: data/table.md, Accessibility.
 */
@Directive({
  selector: '[ppOverflowRegion]',
  host: {
    '[attr.tabindex]': 'over() ? 0 : null',
    '[attr.role]': 'over() ? "region" : null',
    '[attr.aria-label]': 'over() ? name() : null',
  },
})
export class PpOverflowRegion {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly over = signal(false);
  protected readonly name = signal('Table');

  constructor() {
    const check = () => {
      this.over.set(this.el.scrollWidth > this.el.clientWidth + 1);
      this.name.set(this.el.querySelector('caption')?.textContent?.trim() || 'Table');
    };
    const ro = new ResizeObserver(check);
    afterNextRender(() => {
      ro.observe(this.el);
      const table = this.el.querySelector('table');
      if (table) ro.observe(table);
      check();
    });
    inject(DestroyRef).onDestroy(() => ro.disconnect());
  }
}
