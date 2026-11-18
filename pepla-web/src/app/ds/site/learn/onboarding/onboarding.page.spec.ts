import '@angular/compiler';
import '@angular/platform-server/init';
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_DEMOS, ONBOARDING_TABS } from '../content';
import { OnboardingPage } from './onboarding.page';

/**
 * The Onboarding and Offboarding page on the server (SITE-10): it renders without a browser API, holds the page's words, its six demos and its questions in the
 * HTML, and shows every demo as the finished page: with no JavaScript (a prerendered file, a print) the first frame is the last step.
 */
async function render(): Promise<string> {
  const doc = '<!doctype html><html><head></head><body><app-onboarding-page></app-onboarding-page></body></html>';
  return renderApplication((context) => bootstrapApplication(OnboardingPage, { providers: [provideZonelessChangeDetection(), provideRouter([])] }, context), { document: doc });
}

describe('the Onboarding page on the server', () => {
  it('holds one h1, the seven tabs in order, the six demo sections and the closing band, each id once', async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)?.length, 'one h1').toBe(1);
    expect(html.match(/<main[\s>]/g)?.length, 'one main').toBe(1);
    expect(html).toContain('Offer accepted to day one,');
    const tabs = [...html.matchAll(/class="pp-site-subnav__link"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(tabs).toEqual(ONBOARDING_TABS.map((t) => t.label));
    for (const id of [...ONBOARDING_TABS.map((t) => t.id), 'demo']) expect(html.match(new RegExp(`\\sid="${id}"`, 'g'))?.length, `#${id} once`).toBe(1);
    for (const d of Object.values(ONBOARDING_DEMOS)) expect(html.replace(/&#39;/g, "'"), d.title).toContain(d.title);
  });

  it('shows the hero card and the demos as the finished page, and nothing as hidden', async () => {
    const html = await render();
    expect(html).toContain('data-demo="hcard-onboarding"');
    expect(html).toContain('Signed by John Doe, Tue 25 Nov');
    expect(html).toContain('Accepted by Jane Smith, 09:42');
    expect(html).toContain('All documents in. Sample data');
    expect(html).not.toContain('data-site-reveal');
  });

  it('has no "pepla", no "masked" and no placeholder text anywhere in the page', async () => {
    const html = (await render()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
    expect(html.match(/pepla|masked|lorem|placeholder|claude/gi) ?? []).toEqual([]);
  });
});
