import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * One line above the header: pilot companies are welcome, with a link to Book a demo. It scrolls away with the page.
 * Spec: project/components/site/site-pilot.md
 */
@Component({
  selector: 'div[ppSitePilot]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="pp-site-wrap">Naleko People is open for pilot companies.<a class="pp-site-pilot__link" href="#demo">Book a demo</a></div>`,
  host: { class: 'pp-site-pilot' },
})
export class PpSiteLandPilot {}
