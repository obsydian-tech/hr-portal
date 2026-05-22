import { Component, ChangeDetectionStrategy } from '@angular/core';

// Phase D: full implementation — D064–D071 (offer lifecycle, 4 states)
@Component({
  selector: 'tf-offers-page',
  standalone: true,
  imports: [],
  template: `
    <div class="tf-page-stub">
      <h2>Offers</h2>
      <p>Offer lifecycle view — coming in Phase D.</p>
    </div>
  `,
  styles: [`.tf-page-stub { padding: 2rem; font-family: 'Inter', sans-serif; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffersPageComponent {}
