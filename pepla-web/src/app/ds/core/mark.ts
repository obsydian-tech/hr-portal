import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The Naleko People mark: three overlapping circles. `<svg ppMark />`, only inside ds (Logo, app icon).
 * Spec: project/components/core/logo.md
 */
@Component({
  selector: 'svg[ppMark]',
  template: `
    <svg:circle class="pp-logo__coral" cx="20" cy="38" r="18" />
    <svg:circle class="pp-logo__violet" cx="38" cy="24" r="18" />
    <svg:circle class="pp-logo__mint" cx="56" cy="38" r="18" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-logo__mark', viewBox: '0 0 76 64', 'aria-hidden': 'true', focusable: 'false' },
})
export class PpMark {}
