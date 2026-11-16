import '@angular/compiler';
import '@angular/platform-server/init';
import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { renderApplication } from '@angular/platform-server';
import { describe, expect, it } from 'vitest';
import { PP_SITE, SITE_FOOTER, SITE_MENU, SITE_SHEET } from './index';

/**
 * The public site parts on the server: the page frame, header, menu, sheet, hero, section, caps, band and footer
 * render without a browser API, and nothing has "arrived" or hides in the HTML (no JavaScript means the arrival
 * never hides anything: the finished state is the first state).
 */
@Component({
  selector: 'app-ssr-site',
  imports: [...PP_SITE],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div ppSitePage>
      <header ppSiteHeader></header>
      <section ppSiteHero reveal eyebrow="Eyebrow" line="Every employee" accent="hired, onboarded and compliant." lead="Lead sentence.">
        <p ppHeroIntro><strong>Naleko People</strong> intro.</p>
        <a ppSiteButton large href="#demo">Book a demo</a>
      </section>
      <section ppSiteSection titleId="ssr-section">
        <div ppSiteWrap>
          <div ppSiteSectionHead reveal titleId="ssr-section" eyebrow="Recruitment" title="A section title." lead="A section lead."></div>
          <ul ppSiteCaps reveal [items]="caps"></ul>
        </div>
      </section>
      <section ppSiteBand reveal eyebrow="Book a demo" title="Naleko" accent="People." lead="Band lead." note="Band note.">
        <a ppSiteButton large href="#demo">Book a demo</a>
      </section>
      <footer ppSiteFooter></footer>
    </div>
  `,
})
class SsrSite {
  protected readonly caps = [{ title: 'One', text: 'First.' }, { title: 'Two', text: 'Second.', batsi: true }];
}

async function render(): Promise<string> {
  const doc = '<!doctype html><html><head></head><body><app-ssr-site></app-ssr-site></body></html>';
  return renderApplication((context) => bootstrapApplication(SsrSite, { providers: [provideZonelessChangeDetection(), provideRouter([])] }, context), { document: doc });
}

describe('the public site parts on the server', () => {
  it('renders the page frame, header, menu, sheet, hero, section, caps, band and footer without a browser API', async () => {
    const html = await render();
    expect(html).toMatch(/<main[^>]*id="main"/);
    expect(html).toContain('pp-site-sheet');
    expect(html).toContain('pp-site-header');
    expect(html).toContain(SITE_MENU[0].label);
    expect(html).toContain(SITE_SHEET[0].links[0].name);
    expect(html).toContain('pp-site-hero');
    expect(html).toContain('A section title.');
    expect(html).toContain('pp-site-caps');
    expect(html).toContain('pp-site-band');
    expect(html).toContain('pp-site-footer');
    expect(html).toContain(SITE_FOOTER.pin);
  });

  it('shows no item as arrived or hidden: the first frame is the finished page', async () => {
    const html = await render();
    expect(html).not.toContain('pp-site-reveal--in');
  });
});
