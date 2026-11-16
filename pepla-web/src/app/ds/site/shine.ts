import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * A light passing over the accent words of a headline. `text` is the words; the glow copies them exactly.
 * `<span ppSiteShine text="hired, onboarded and compliant."></span>`, or `inline` for a few words inside a line.
 * Spec: project/components/site/site-shine.md
 */
@Component({
  selector: 'span[ppSiteShine]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ text() }}<span class="pp-site-shine__glow" aria-hidden="true"><span class="pp-site-shine__copy">{{ text() }}</span></span>`,
  host: { class: 'pp-site-shine', '[class.pp-site-shine--inline]': 'inline()' },
})
export class PpSiteShine {
  readonly text = input.required<string>();
  readonly inline = input(false, { transform: booleanAttribute });
}
