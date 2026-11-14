import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpPageHeader, type Crumb } from '../../ds';

/**
 * Holds the place of the document page until ONB-15 builds it. It reads nothing and calls no API.
 */
@Component({
  selector: 'app-document-holding',
  imports: [PpPageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header heading="Document" [breadcrumbs]="crumbs" />
      <p class="pp-text">This document opens here once document decisions are built.</p>
    </div>
  `,
})
export class DocumentHoldingPage {
  protected readonly crumbs: Crumb[] = [
    { label: 'Home', link: '/hr' },
    { label: 'Documents to check', link: '/hr/documents' },
  ];
}
