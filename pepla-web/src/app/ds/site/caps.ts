import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { PpLozenge } from '../status/lozenge';
import { PpSiteReveal } from './motion';

/** One column: a title, a sentence, and the Batsi tag only where Batsi does the work. */
export interface SiteCap { title: string; text: string; batsi?: boolean }

/**
 * A row of four short columns that closes a module section. One column on a phone, two from 768px, four from 1080px of the
 * section's own width. Exactly four items, so the row fills. Spec: project/components/site/site-caps.md
 */
@Component({
  selector: 'ul[ppSiteCaps]',
  imports: [PpLozenge, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (cap of items(); track cap.title) {
      <li class="pp-site-caps__item" [ppSiteReveal]="$index" [revealOn]="reveal()">
        <h3 class="pp-site-caps__title">{{ cap.title }}</h3>
        <p class="pp-site-caps__text">{{ cap.text }}</p>
        @if (cap.batsi) { <pp-lozenge status="agent" icon="sparkles">Batsi</pp-lozenge> }
      </li>
    }
  `,
  host: { class: 'pp-site-caps' },
})
export class PpSiteCaps {
  readonly items = input.required<readonly SiteCap[]>();
  /** The four arrive one after another as they scroll into view. */
  readonly reveal = input(false, { transform: booleanAttribute });
}
