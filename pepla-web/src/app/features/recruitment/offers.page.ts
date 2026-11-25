import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton, PpCell, PpEmptyState, PpPageHeader, PpPerson, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap } from '../../ds';
import { HireApi } from './hire-api';
import { OFFER_TONE, OFFER_WORD, dayOf, type OfferRow } from './offer-words';

/** REC-UI-04: Offers, every offer in one list. */
@Component({
  selector: 'app-offers-page',
  imports: [RouterLink, PpButton, PpCell, PpEmptyState, PpPageHeader, PpPerson, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-200">
      <pp-page-header heading="Offers" description="Every offer in one list." />
      @if (status() === 'failed') {
        <pp-section-message tone="danger" heading="Offers could not be loaded."><pp-section-message-actions><button ppButton type="button" (click)="load()">Try again</button></pp-section-message-actions></pp-section-message>
      } @else if (status() === 'ready') {
        @if (!rows().length) { <pp-empty-state heading="No one yet" /> }
        @else {
          <pp-table-wrap>
            <table ppTable [stack]="true">
              <caption class="pp-visually-hidden">Offers</caption>
              <thead><tr><th scope="col">Candidate</th><th scope="col">Role</th><th scope="col">State</th><th scope="col">Expires</th><th scope="col">Approver</th><th scope="col"><span class="pp-visually-hidden">Open</span></th></tr></thead>
              <tbody>
                @for (r of rows(); track r.offer_id) {
                  <tr>
                    <td ppCell label="Candidate"><pp-person [name]="r.candidate_name ?? ''" [link]="'/hire/offers/' + r.offer_id" size="small" /></td>
                    <td ppCell label="Role">{{ r.role_title }}</td>
                    <td ppCell label="State"><span [class]="'pp-lozenge' + (tone(r.state) ? ' pp-lozenge--' + tone(r.state) : '')">{{ word(r.state) }}</span></td>
                    <td ppCell label="Expires">{{ r.expires_at ? day(r.expires_at) : '' }}</td>
                    <td ppCell label="Approver">{{ r.approver_name ?? '' }}</td>
                    <td ppCell="actions"><a ppButton appearance="subtle" size="small" [iconOnly]="true" icon="chevron-right" [routerLink]="['/hire/offers', r.offer_id]" [attr.aria-label]="'Open ' + r.candidate_name"></a></td>
                  </tr>
                }
              </tbody>
            </table>
          </pp-table-wrap>
        }
      }
    </div>`,
})
export class OffersPage implements OnInit {
  private readonly api = inject(HireApi);
  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly rows = signal<OfferRow[]>([]);
  protected readonly day = dayOf;
  protected word(s: string) { return OFFER_WORD[s] ?? s; }
  protected tone(s: string) { return OFFER_TONE[s] ?? ''; }
  ngOnInit() { void this.load(); }
  protected async load() {
    this.status.set('loading');
    const r = await this.api.call<{ offers?: OfferRow[] }>('GET', '/v1/offers');
    if (!r || r.status !== 200) return this.status.set('failed');
    this.rows.set(r.body?.offers ?? []);
    this.status.set('ready');
  }
}
