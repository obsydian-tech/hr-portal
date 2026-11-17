import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpSiteLanding } from './sections/landing';

/** /dev/site-landing-page: the whole assembled landing page (dev only, until SITE-01's public route renders it). */
@Component({
  selector: 'app-site-landing-page',
  imports: [PpSiteLanding],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div ppSiteLanding></div>',
})
export class SiteLandingPage {}
