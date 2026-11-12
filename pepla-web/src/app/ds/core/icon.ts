import { ChangeDetectionStrategy, Component, ElementRef, Renderer2, computed, effect, inject, input } from '@angular/core';
import { ICONS, IconName } from './icon.registry';

const SVG = 'http://www.w3.org/2000/svg';
export type IconTone = 'subtle' | 'brand' | 'agent' | 'success' | 'warning' | 'danger' | 'information';

/**
 * An icon from the Pepla vocabulary: `<svg ppIcon="sparkles" />`.
 * The host is the <svg> itself, so component CSS that styles `> svg` applies.
 * Decorative by default (aria-hidden). Give `label` when the icon carries meaning on its own.
 * Spec: project/components/core/icon.md
 */
@Component({
  selector: 'svg[ppIcon]',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    xmlns: SVG,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    width: '24',
    height: '24',
    '[class]': 'classes()',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() ?? null',
    focusable: 'false',
  },
})
export class PpIcon {
  readonly ppIcon = input.required<IconName>();
  readonly tone = input<IconTone>();
  readonly size = input<'small' | 'medium' | 'large'>();
  readonly label = input<string>();

  protected readonly classes = computed(() => {
    const t = this.tone(), s = this.size();
    return { lucide: true, 'pp-icon': !!(t || s), [`pp-icon--${t}`]: !!t, [`pp-icon--${s}`]: !!s && s !== 'medium' };
  });

  private readonly host = inject<ElementRef<SVGSVGElement>>(ElementRef).nativeElement;
  private readonly r = inject(Renderer2);

  constructor() {
    effect(() => {
      const node = ICONS[this.ppIcon()];
      for (const child of Array.from(this.host.childNodes)) this.r.removeChild(this.host, child);
      for (const [tag, attrs] of node) {
        const el = this.r.createElement(tag, 'svg');
        for (const [k, v] of Object.entries(attrs)) if (v !== undefined) this.r.setAttribute(el, k, String(v));
        this.r.appendChild(this.host, el);
      }
    });
  }
}
