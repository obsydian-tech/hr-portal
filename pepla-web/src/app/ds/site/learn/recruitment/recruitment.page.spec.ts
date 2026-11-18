import '@angular/compiler';
import '@angular/platform-server/init';
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { RECRUITMENT_DEMOS, RECRUITMENT_TABS } from '../content';
import { RecruitmentPage } from './recruitment.page';

/**
 * The Recruitment page on the server (SITE-09): it renders without a browser API, holds the page's words, its five demos and its questions in the HTML,
 * and shows every demo as the finished page: with no JavaScript (a prerendered file, a print) the first frame is the last step.
 */
async function render(): Promise<string> {
  const doc = '<!doctype html><html><head></head><body><app-recruitment-page></app-recruitment-page></body></html>';
  return renderApplication((context) => bootstrapApplication(RecruitmentPage, { providers: [provideZonelessChangeDetection(), provideRouter([])] }, context), { document: doc });
}

describe('the Recruitment page on the server', () => {
  it('holds one h1, the six tabs in order, the five demo sections and the closing band, each id once', async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)?.length, 'one h1').toBe(1);
    expect(html.match(/<main[\s>]/g)?.length, 'one main').toBe(1);
    expect(html).toContain('Every candidate tracked');
    const tabs = [...html.matchAll(/class="pp-site-subnav__link"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(tabs).toEqual(RECRUITMENT_TABS.map((t) => t.label));
    for (const id of [...RECRUITMENT_TABS.map((t) => t.id), 'demo']) expect(html.match(new RegExp(`\\sid="${id}"`, 'g'))?.length, `#${id} once`).toBe(1);
    for (const d of Object.values(RECRUITMENT_DEMOS)) expect(html, d.title).toContain(d.title);
  });

  it('shows the hero card, the board and every demo as the finished page, and nothing as hidden', async () => {
    const html = await render();
    expect(html).toContain('data-demo="hcard-recruitment"');
    expect(html.match(/pp-site-board__col"/g)?.length, 'six stage columns').toBe(6);
    expect(html).toContain('Logged: Candidate 5 to Not hired');
    expect(html).toContain('pp-site-board__log--in');
    expect(html).toContain('Moved to Offer by Jane Smith, reason recorded');
    expect(html).toContain('Offer signed · Hired');
    expect(html).toContain('Onboarding opened for John Doe. Jane Smith notified.');
    expect(html.match(/pp-site-demo__again--in/g)?.length, 'every demo shows Play again').toBe(5);
    expect(html).not.toContain('pp-site-reveal--in');
  });

  it('has no "pepla", no "masked" and no placeholder text anywhere in the page', async () => {
    const html = (await render()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
    expect(html.match(/pepla|masked|lorem|placeholder|claude/gi) ?? []).toEqual([]);
  });
});
