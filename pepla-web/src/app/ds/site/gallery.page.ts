import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpCard, PpCardBody } from '../data/data';
import { PpIcon } from '../core/icon';
import { PpLozenge } from '../status/lozenge';
import { PP_SITE, SiteCap, SiteLight } from './index';

/**
 * /dev/site: every part of the public site in each of its design system kit examples (project/components/site/*.examples.html),
 * with the kit's own words and sample people, so the tests, the parity check and the side-by-side page can compare the
 * Angular component with its kit. Dev only: not linked from anywhere, not prerendered. Each example is a
 * `section[data-example]` with an `h2` for its name and a `[data-example-body]` that holds exactly what the kit holds.
 */
@Component({
  selector: 'app-site-gallery',
  imports: [...PP_SITE, PpCard, PpCardBody, PpIcon, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gallery.page.html',
  host: { '(click)': 'noNavigate($event)' },
})
export class SiteGalleryPage {
  /**
   * The links in the kit examples have no real target (`#`, `#demo`, `#batsi`). Under `<base href="/">` a bare hash
   * would load `/`, so a tap on one is cancelled unless its target is on this page (the skip link's own `#main-n`).
   */
  protected noNavigate(event: Event): void {
    const a = (event.target as Element | null)?.closest?.('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href')!.slice(1);
    if (!id || !document.getElementById(id)) event.preventDefault();
  }
  protected readonly three: SiteLight[] = [
    { tone: 'violet', x: '70%', y: '30%', index: 0 }, { tone: 'mint', x: '88%', y: '85%', size: '34cqw', index: 1 }, { tone: 'coral', x: '15%', y: '85%', size: '36cqw', index: 2 },
  ];
  protected readonly heroDesktop: SiteLight[] = [
    { tone: 'violet', x: '62%', y: '30%', size: '44cqw', index: 0 }, { tone: 'mint', x: '86%', y: '78%', size: '34cqw', index: 1 }, { tone: 'coral', x: '18%', y: '78%', size: '36cqw', index: 2 },
  ];
  protected readonly heroPhone: SiteLight[] = [
    { tone: 'violet', x: '70%', y: '22%', size: '70cqw', index: 0 }, { tone: 'mint', x: '90%', y: '85%', size: '60cqw', index: 1 }, { tone: 'coral', x: '10%', y: '75%', size: '60cqw', index: 2 },
  ];
  protected readonly bandDesktop: SiteLight[] = [
    { tone: 'violet', x: '25%', y: '20%', size: '40cqw', index: 0 }, { tone: 'mint', x: '80%', y: '70%', size: '36cqw', index: 1 }, { tone: 'coral', x: '60%', y: '10%', size: '26cqw', index: 2 },
  ];
  protected readonly bandPhone: SiteLight[] = [
    { tone: 'violet', x: '25%', y: '20%', size: '70cqw', index: 0 }, { tone: 'mint', x: '85%', y: '80%', size: '60cqw', index: 1 },
  ];
  protected readonly chips = ['BCEA', 'UIF', 'SARS', 'POPIA'];
  protected readonly caps: SiteCap[] = [
    { title: 'Six hiring stages', text: 'Applied, Screening, Interview, Offer, Hired and Not hired. Every move recorded with a reason.' },
    { title: 'Interview panels', text: 'Panel members score against the same criteria. No candidate is rejected automatically.' },
    { title: 'Reminders and follow-ups', text: 'Interviewers reminded to submit feedback. Candidates reminded to reply or upload.', batsi: true },
    { title: 'Candidate risk', text: 'At-risk flags for no reply, missed interviews and offers close to expiry.', batsi: true },
  ];
  protected readonly modules = ['Recruitment', 'Onboarding and Offboarding', 'Leave Management'];
  protected readonly filler = [
    'Sample page content. John Doe asked for leave and Jane Smith approved it.',
    'Sample page content. The header stays at the top while this scrolls.',
    'Sample page content.', 'Sample page content.', 'Sample page content.', 'Sample page content.', 'Sample page content.', 'Sample page content.',
  ];
  protected readonly spacer = Array.from({ length: 14 }, () => 'Sample page content.');
  protected readonly footerFiller = ['Sample page content. John Doe asked for leave and Jane Smith approved it.', 'Sample page content.'];
}
