import { AfterContentInit, ChangeDetectionStrategy, Component, ElementRef, Renderer2, booleanAttribute, inject, input } from '@angular/core';

/**
 * The Naleko Digital Solutions gradient on the company name only: `<span ppSiteGradientText>Naleko Digital Solutions.</span>`.
 * `flow` makes the colours move (two opacity fades); it copies the words into `data-text`.
 * Spec: project/components/site/site-gradient.md
 */
@Component({
  selector: 'span[ppSiteGradientText]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { class: 'pp-site-gradient-text', '[class.pp-site-gradient-text--flow]': 'flow()' },
})
export class PpSiteGradientText implements AfterContentInit {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);
  readonly flow = input(false, { transform: booleanAttribute });
  ngAfterContentInit(): void {
    if (this.flow()) this.renderer.setAttribute(this.el, 'data-text', (this.el.textContent ?? '').trim());
  }
}

/** A one-pixel rule in the same gradient; `flow` is the two-pixel line above the footer. Decorative. */
@Component({
  selector: 'span[ppSiteGradientLine]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: { class: 'pp-site-gradient-line', 'aria-hidden': 'true', '[class.pp-site-gradient-line--flow]': 'flow()' },
})
export class PpSiteGradientLine {
  readonly flow = input(false, { transform: booleanAttribute });
}
