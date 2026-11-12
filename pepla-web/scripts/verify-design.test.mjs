// One small fixture per verify:design rule, each of which must fail. A rule that stops catching its
// fixture fails these tests, so the check cannot be weakened quietly. Run: npm run test:design
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCss, checkTemplate, checkTs, checkPackage, checkTokens, checkRegistry } from './verify-design.mjs';
import { DEST } from './design-system-sync.mjs';
import { render } from './icon-registry.mjs';

const rules = (list) => list.map((v) => v.rule);
const fails = (list, rule, why) => assert.ok(rules(list).includes(rule), `expected a [${rule}] failure: ${why}\n${JSON.stringify(list)}`);
const screen = (html) => checkTemplate(html, { inDs: false });
const ds = (html, hostBlocks = []) => checkTemplate(html, { inDs: true, hostBlocks });

test('a clean screen passes', () => {
  const html = `<pp-page-header heading="Candidates" />
    <div class="pp-columns pp-gap-300"><pp-card heading="Pipeline"><table ppTable><tr><td ppCell>1</td></tr></table></pp-card>
    <div class="pp-stack" [style.--_width]="w"><button ppButton appearance="primary" icon="plus">Add</button><svg ppIcon="check" /></div></div>`;
  assert.deepEqual(screen(html), []);
  assert.deepEqual(checkCss('.x { display: grid; gap: var(--space-200); }', { feature: true }), []);
});

test('tokens: a hand edit or a stray file under src/styles/design-system fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pepla-tokens-'));
  try {
    cpSync(DEST, dir, { recursive: true });
    assert.deepEqual(checkTokens(dir, join(dir, 'sync.json')), []);
    writeFileSync(join(dir, 'tokens', 'colors.css'), '/* edited */');
    fails(checkTokens(dir, join(dir, 'sync.json')), 'tokens', 'edited token file');
    cpSync(DEST, dir, { recursive: true });
    writeFileSync(join(dir, 'extra.css'), '.pp-x {}');
    fails(checkTokens(dir, join(dir, 'sync.json')), 'tokens', 'file not from the sync');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('colour: hex, colour functions, named colours and palette steps fail', () => {
  fails(checkCss('.a { color: #5b4bd6; }'), 'colour', 'hex');
  fails(checkCss('.a { background: rgb(0 0 0); }'), 'colour', 'rgb()');
  fails(checkCss('.a { background: color-mix(in oklab, var(--color-text), white); }'), 'colour', 'color-mix');
  fails(checkCss('.a { border-color: red; }'), 'colour', 'named colour');
  fails(checkCss('.a { color: var(--palette-violet-600); }'), 'colour', 'palette step');
  fails(screen('<p>Brand is #ff7a59</p>'), 'colour', 'hex in a template');
});

test('type: font families and literal sizes, weights, line heights and tracking fail', () => {
  fails(checkCss('.a { font-family: Arial; }'), 'type', 'font family');
  fails(checkCss('.a { font-size: 14px; }'), 'type', 'font size');
  fails(checkCss('.a { font-weight: 600; }'), 'type', 'font weight');
  fails(checkCss('.a { line-height: 1.4; }'), 'type', 'line height');
  fails(checkCss('.a { font: 14px Inter; }'), 'type', 'font shorthand');
});

test('shape: a radius that is not a token fails', () => fails(checkCss('.a { border-radius: 6px; }'), 'shape', '6px'));

test('motion: literal durations and easings fail', () => {
  fails(checkCss('.a { transition: opacity 200ms ease; }'), 'motion', '200ms');
  fails(checkCss('.a { transition-timing-function: cubic-bezier(.2,0,0,1); }'), 'motion', 'cubic-bezier');
});

test('layers: a literal z-index fails', () => fails(checkCss('.a { z-index: 999; }'), 'layers', '999'));

test('markup: inline styles fail, except --_* inputs', () => {
  fails(screen('<div style="margin-top: 8px"></div>'), 'markup', 'static style');
  fails(screen('<div [ngStyle]="s"></div>'), 'markup', 'ngStyle');
  fails(screen('<div [style.color]="c"></div>'), 'markup', '[style.color]');
  fails(screen('<div [style]="s"></div>'), 'markup', '[style]');
  assert.deepEqual(screen('<div class="pp-stack" style="--_width: 40%"></div>'), []);
});

test('markup: native controls need their ds directive; no native select', () => {
  fails(screen('<button type="button">Save</button>'), 'markup', 'bare button');
  fails(screen('<input type="text">'), 'markup', 'bare input');
  fails(screen('<textarea></textarea>'), 'markup', 'bare textarea');
  fails(screen('<table></table>'), 'markup', 'bare table');
  fails(screen('<select></select>'), 'markup', 'native select');
});

test('markup: screens use only Layout and text classes; every class is a defined pp- class', () => {
  fails(screen('<div class="mt-4"></div>'), 'markup', 'not a Naleko People class');
  fails(screen('<div class="pp-made-up"></div>'), 'markup', 'undefined pp- class');
  fails(screen('<div class="pp-card__header"></div>'), 'markup', 'component class in a screen');
  fails(screen('<div [class.pp-card]="x"></div>'), 'markup', 'component class bound in a screen');
  fails(ds('<div class="pp-not-real"></div>'), 'markup', 'undefined class inside ds');
  fails(checkTs("@Component({ host: { class: 'pp-card pp-card--made-up' } })", { inDs: true }), 'markup', 'undefined modifier in host');
  fails(screen('<style>.a{}</style>'), 'markup', 'style block');
});

test('anatomy: a part outside its block fails in ds', () => {
  fails(ds('<div class="pp-card__header"></div>'), 'anatomy', 'card part with no card');
  assert.deepEqual(ds('<div class="pp-card"><div class="pp-card__header"></div></div>'), []);
  assert.deepEqual(ds('<div class="pp-card__header"></div>', ['pp-card']), []);
});

test('styles: screen stylesheets only lay out; order and reverse fail everywhere', () => {
  fails(checkCss('.a { color: var(--color-text); }', { feature: true }), 'styles', 'colour in a screen stylesheet');
  fails(checkCss('.a { padding: var(--space-200); }', { feature: true }), 'styles', 'padding in a screen stylesheet');
  fails(checkCss('.a { order: 2; }', { inDs: true }), 'styles', 'order');
  fails(checkCss('.a { flex-direction: row-reverse; }', { inDs: true }), 'styles', 'row-reverse');
  fails(checkTs('@Component({ styles: `.a { margin: 4px; }` })'), 'styles', 'inline styles in a screen component');
});

test('icons: glyphs, arrows, hand-written svg, unknown names, stray Lucide and a stale registry fail', () => {
  fails(screen('<span>✓ Done</span>'), 'icons', 'check glyph');
  fails(screen('<span>&rarr;</span>'), 'icons', 'arrow entity');
  fails(screen('<a ppLink href="/x">Next →</a>'), 'icons', 'trailing arrow');
  fails(screen('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'), 'icons', 'hand-written svg');
  fails(screen('<svg ppIcon="unicorn" />'), 'icons', 'name not in the vocabulary');
  fails(screen('<button ppButton icon="unicorn">x</button>'), 'icons', 'icon input not in the vocabulary');
  fails(checkTs("import { Check } from 'lucide';"), 'icons', 'Lucide outside the registry');
  assert.deepEqual(checkTs("import { Check } from 'lucide';", { isRegistry: true }), []);
  fails(checkRegistry(render().replace("'check': Check,", '')), 'icons', 'stale registry');
});

test('deps: PrimeNG and other UI kits fail in code, templates and package.json', () => {
  fails(checkTs("import { DatePicker } from 'primeng/datepicker';", { inDs: true }), 'deps', 'primeng import, even in ds');
  fails(checkTs("import { MatButton } from '@angular/material/button';"), 'deps', 'Material import');
  fails(screen('<p-datepicker />'), 'deps', 'p- element');
  fails(screen('<button pButton ppButton>Save</button>'), 'deps', 'pButton directive');
  fails(checkPackage({ dependencies: { primeng: '22.1.4' } }), 'deps', 'primeng');
  fails(checkPackage({ dependencies: { primeicons: '7.0.0' } }), 'deps', 'primeicons');
  fails(checkPackage({ devDependencies: { tailwindcss: '4.0.0' } }), 'deps', 'tailwind');
  fails(checkPackage({ dependencies: { '@fortawesome/fontawesome-free': '6.0.0' } }), 'deps', 'second icon set');
  assert.deepEqual(checkPackage({ dependencies: { '@angular/aria': '22.2.7', '@angular/cdk': '22.2.7', lucide: '1.39.0' } }), []);
});
