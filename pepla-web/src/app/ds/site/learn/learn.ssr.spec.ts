import '@angular/compiler';
import '@angular/platform-server/init';
import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { COMPLIANCE_ENDING, COMPLIANCE_TOP, LEAVE_ENDING, LEAVE_TOP, ONBOARDING_ENDING, ONBOARDING_TOP, PLATFORM_ENDING, PLATFORM_TOP, RECRUITMENT_ENDING, RECRUITMENT_TOP, SECURITY_ENDING, SECURITY_TOP } from './content';
import { PpSiteLearnDemo } from './learn.demo';
import { PpSiteLearnPage } from './learn.page';
import { PpSiteLearnRows } from './learn.panels';

/**
 * A Learn more page on the server (SITE-08, AC-9): `ppSiteLearnPage` with each of the six endings (Recruitment, Onboarding, Compliance,
 * Leave, Security, Platform) renders without a browser API, holds the page's words and its questions in the HTML, and shows nothing as
 * arrived or hidden: with no JavaScript the first frame is the finished page.
 */
const PAGES = [
  { name: 'Recruitment', uid: 'recruitment', top: RECRUITMENT_TOP, ending: RECRUITMENT_ENDING },
  { name: 'Onboarding', uid: 'onboarding', top: ONBOARDING_TOP, ending: ONBOARDING_ENDING },
  { name: 'Compliance', uid: 'compliance', top: COMPLIANCE_TOP, ending: COMPLIANCE_ENDING },
  { name: 'Leave', uid: 'leave', top: LEAVE_TOP, ending: LEAVE_ENDING },
  { name: 'Security', uid: 'security', top: SECURITY_TOP, ending: SECURITY_ENDING },
  { name: 'Platform', uid: 'platform', top: PLATFORM_TOP, ending: PLATFORM_ENDING },
] as const;
const DEMO = { eyebrow: 'A demo', title: 'A demo headline.', lead: 'A demo line.', points: [{ text: 'A point' }, { text: 'Another point', batsi: true }] };

@Component({
  selector: 'app-ssr-learn',
  imports: [PpSiteLearnPage, PpSiteLearnDemo, PpSiteLearnRows],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of pages; track p.uid) {
      <div ppSiteLearnPage [uid]="p.uid" [top]="p.top" [tabs]="[{ id: 'demo-' + p.uid, label: 'A demo' }, { id: 'questions', label: 'Questions' }]" [ending]="p.ending">
        <section ppSiteLearnDemo [id]="'demo-' + p.uid" [uid]="p.uid" [text]="demo" engine="steps" live><div ppSiteLearnRows></div></section>
      </div>
    }
  `,
})
class SsrLearn {
  protected readonly pages = PAGES;
  protected readonly demo = DEMO;
}

async function render(): Promise<string> {
  const doc = '<!doctype html><html><head></head><body><app-ssr-learn></app-ssr-learn></body></html>';
  return renderApplication((context) => bootstrapApplication(SsrLearn, { providers: [provideZonelessChangeDetection(), provideRouter([])] }, context), { document: doc });
}

describe('a Learn more page on the server', () => {
  it('renders the page with each of the six endings, its words and its questions, without a browser API', async () => {
    const html = await render();
    expect(html.match(/pp-site-form-page--learn/g)?.length, 'six page tops').toBe(6);
    expect(html).toContain('aria-label="On this page"');
    expect(html).toContain('pp-site-demo__panel');
    for (const p of PAGES) {
      expect(html, `the ${p.name} top`).toContain(p.top.eyebrow);
      expect(html, `the ${p.name} ending: Ask Batsi`).toContain(p.ending.ask.title);
      expect(html, `the ${p.name} ending: the questions are in the HTML`).toContain(p.ending.faq.items[0]!.q);
      expect(html, `the ${p.name} ending: the answers are in the HTML`).toContain(p.ending.faq.items[0]!.a);
      expect(html, `the ${p.name} ending: the related cards`).toContain(p.ending.related[0]!.title);
    }
    expect(html.match(/pp-site-faq__q/g)?.length, 'every question of every ending is a button').toBe(PAGES.reduce((n, p) => n + p.ending.faq.items.length, 0));
    expect(html).toContain('aria-expanded="true"');
  });

  it('shows no item as arrived or hidden: the first frame is the finished page', async () => {
    const html = await render();
    expect(html).not.toContain('pp-site-reveal--in');
    expect(html).toContain('pp-site-reveal');
  });
});
