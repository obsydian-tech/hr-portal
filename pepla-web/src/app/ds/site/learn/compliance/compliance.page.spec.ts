import '@angular/compiler';
import '@angular/platform-server/init';
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { COMPLIANCE_DEMOS, COMPLIANCE_TABS } from '../content';
import { CompliancePage } from './compliance.page';

/**
 * The Compliance Management page on the server (SITE-11): it renders without a browser API, holds the page's words, its five demos and its questions in the
 * HTML, and shows every demo as the finished page: with no JavaScript (a prerendered file, a print) the first frame is the last step.
 */
async function render(): Promise<string> {
  const doc = '<!doctype html><html><head></head><body><app-compliance-page></app-compliance-page></body></html>';
  return renderApplication((context) => bootstrapApplication(CompliancePage, { providers: [provideZonelessChangeDetection(), provideRouter([])] }, context), { document: doc });
}

describe('the Compliance page on the server', () => {
  it('holds one h1, the six tabs in order, the five demo sections and the closing band, each id once', async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)?.length, 'one h1').toBe(1);
    expect(html.match(/<main[\s>]/g)?.length, 'one main').toBe(1);
    expect(html).toContain('Every certificate tracked');
    const tabs = [...html.matchAll(/class="pp-site-subnav__link"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(tabs).toEqual(COMPLIANCE_TABS.map((t) => t.label));
    for (const id of [...COMPLIANCE_TABS.map((t) => t.id), 'demo']) expect(html.match(new RegExp(`\\sid="${id}"`, 'g'))?.length, `#${id} once`).toBe(1);
    for (const d of Object.values(COMPLIANCE_DEMOS)) expect(html.replace(/&#39;/g, "'"), d.title).toContain(d.title);
  });

  it('shows the hero card and the demos as the finished page, and nothing as hidden', async () => {
    const html = await render();
    expect(html).toContain('data-demo="hcard-compliance"');
    expect(html).toContain('Accepted by Jane Smith, 11:24');
    expect(html).toContain('Every employee is cleared to work.');
    expect(html).not.toContain('data-site-reveal');
  });

  it('has no "pepla", no "masked" and no placeholder text anywhere in the page', async () => {
    const html = (await render()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
    expect(html.match(/pepla|masked|lorem|placeholder|claude/gi) ?? []).toEqual([]);
  });
});
