#!/usr/bin/env node
// verify:design: the only way to build UI in Naleko People, checked on every build (prebuild) and in CI.
// Spec: pepla-design-system docs/verify-design-angular.md. There is no escape hatch: no ignore
// comment, no allowlist file, no baseline. Fix the code, or change the design system and sync it.
//
// Reads src/**: .html templates, .ts (inline template:, styles:, host:, imports), .css, and
// package.json. Prints file:line [rule] text and exits 1 on any violation.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEST, MANIFEST, owned, sha256 } from './design-system-sync.mjs';
import { REGISTRY, render as renderRegistry } from './icon-registry.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const walk = (d) => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });

// ------------------------------------------------------------------ the design system, as synced
const COMPONENTS_CSS = readFileSync(join(DEST, 'components.css'), 'utf8') + readFileSync(join(DEST, 'tokens', 'base.css'), 'utf8') + readFileSync(join(DEST, 'tokens', 'typography.css'), 'utf8');
export const CLASSES = new Set([...COMPONENTS_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(pp-[a-z0-9_-]+)/g)].map((m) => m[1]));
export const VOCAB = new Set(JSON.parse(readFileSync(join(DEST, 'icons.json'), 'utf8')).icons.map((i) => i.name));
/** Classes a screen may use: Layout and the text helpers. Everything else comes from a pp-* component. */
const LAYOUT = /^pp-(?:stack|inline|columns|grid|gap|grow|fixed|push|shrink|measure|width-field|scroll|text|heading|visually-hidden)(?:$|-)/;
/** Directives that make a native element a design system control. */
const NATIVE = { button: /\b(?:ppButton|ppMenuItem)\b/, input: /\bppTextField\b/, textarea: /\bppTextarea\b/, table: /\bppTable\b/, select: null };
/** Third-party packages that would bring a second look, icon set or UI kit. */
const BANNED_DEPS = /^(?:primeng|primeflex|primeicons|@primeuix\/.*|@primeng\/.*|@angular\/material|bootstrap|ng-bootstrap|@ng-bootstrap\/.*|tailwindcss|@fortawesome\/.*|@ng-icons\/.*|material-icons|material-symbols|@material-symbols\/.*|lucide-angular|@lucide\/.*|ionicons|feather-icons|@tabler\/icons.*|@heroicons\/.*|@fontsource\/(?!inter|manrope).*)$/;
const LAYOUT_PROPS = /^(?:display|grid(?:-[a-z-]+)?|flex(?:-[a-z-]+)?|gap|row-gap|column-gap|align-[a-z-]+|justify-[a-z-]+|place-[a-z-]+|width|min-width|max-width|height|min-height|max-height|inline-size|block-size|min-inline-size|max-inline-size|overflow(?:-[xy])?|container(?:-[a-z]+)?|--_[\w-]+)$/;

// ------------------------------------------------------------------ patterns
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1}|[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?(?![0-9a-zA-Z_-])/;
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/;
const NAMED_COLOR = /(?:^|[\s:,(])(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|silver|gold|teal|maroon|olive|lime|aqua|fuchsia)(?=[\s;,)!]|$)/i;
const ICON_GLYPHS = /[✓✔✗✘✕✖⚠⛔●○◉◐◑◒◓◷◇◆■□▣▪▫▲△▼▽▶▷◀◁▸▹▾▿▴▵▬✦✧★☆✎✏✐↺↻⟳⟲ⓘℹ⇄⇆↔↕☰⋮⋯]|(?![©®™])\p{Extended_Pictographic}/u;
const ARROW = '[←→↑↓⇐⇒]';
const ARROWS = [
  new RegExp(`<[a-zA-Z][^>]*>\\s*${ARROW}\\s*</`), new RegExp(`<[a-zA-Z][^>]*>\\s*${ARROW}\\s+\\S`),
  new RegExp(`\\S\\s+${ARROW}\\s*</`), new RegExp(`^\\s*${ARROW}(\\s|$)`),
];
const ENTITIES = { larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓', cross: '✗', rsaquo: '›', raquo: '»', laquo: '«', dtrif: '▾', rtrif: '▸' };
const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
const blank = (s) => s.replace(/[^\n]/g, ' ');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const TOKEN = (prefix) => new RegExp(`^(?:inherit|var\\(--${prefix}[\\w-]*\\)|var\\(--_[\\w-]+(?:,\\s*var\\(--${prefix}[\\w-]*\\))?\\))$`);

// ------------------------------------------------------------------ stylesheets
/** Token rules for any CSS: colour, type, shape, motion, layers, and source order. `feature` adds the layout-only rule. */
export function checkCss(raw, { feature = false, inDs = false } = {}) {
  const out = [];
  const report = (line, rule, text) => out.push({ line, rule, text: String(text).trim().slice(0, 160) });
  const body = raw.replace(/\/\*[\s\S]*?\*\//g, blank);
  for (const m of body.matchAll(/(^|[;{\s])(-?-?[a-zA-Z][\w-]*)\s*:\s*([^;{}]+?)\s*(?=;|}|$)/gm)) {
    const prop = m[2].toLowerCase();
    const value = m[3].trim();
    if (!value || /^(?:hover|focus|active|not|is|has|where|before|after|first|last|nth|checked|disabled|focus-visible|focus-within|root|host|placeholder|empty|only|marker|selection|indeterminate|invalid|read-only|target|visited|link|any-link)$/.test(prop)) continue;
    const line = lineOf(body, m.index + m[1].length);
    const decl = `${prop}: ${value}`;
    if (HEX.test(value) || COLOR_FN.test(value)) report(line, 'colour', decl);
    if (!prop.startsWith('--') && NAMED_COLOR.test(` ${value}`) && !/^(?:font|grid|animation|transition|will-change|content|list-style)/.test(prop)) report(line, 'colour', decl);
    if (/--palette-/.test(value)) report(line, 'colour', `palette step, use a semantic token: ${decl}`);
    if (prop === 'font-family' && !TOKEN('font-family').test(value)) report(line, 'type', decl);
    if (prop === 'font' && !TOKEN('font-').test(value)) report(line, 'type', `use font: var(--font-*): ${decl}`);
    if (/^(?:font-size|font-weight|line-height|letter-spacing)$/.test(prop) && !/^(?:inherit|normal|0|var\(--[\w-]+\))$/.test(value)) report(line, 'type', `use the --font-* tokens: ${decl}`);
    if (/^border(?:-[a-z]+)*-radius$/.test(prop) && !value.split(/\s+(?![^(]*\))/).every((v) => /^(?:0|50%|inherit|var\(--radius-[\w-]+\)|var\(--_[\w-]+(?:,\s*var\(--radius-[\w-]+\))?\))$/.test(v))) report(line, 'shape', `use var(--radius-*): ${decl}`);
    if (/cubic-bezier\(|\blinear\(/.test(value)) report(line, 'motion', `use var(--motion-easing-*): ${decl}`);
    if (/^(?:transition|transition-duration|transition-delay|animation|animation-duration|animation-delay)$/.test(prop) && /(?:^|[\s,])\d*\.?\d+m?s\b/.test(value.replace(/var\([^)]*\)/g, ''))) report(line, 'motion', `use var(--motion-duration-*): ${decl}`);
    if (prop === 'z-index' && !/^(?:-1|0|1|auto|var\(--layer-[\w-]+\))$/.test(value)) report(line, 'layers', `use var(--layer-*): ${decl}`);
    if (prop === 'order' || /(?:row|column)-reverse/.test(value)) report(line, 'styles', `reading order is source order: ${decl}`);
    if (feature && !inDs && !LAYOUT_PROPS.test(prop)) report(line, 'styles', `a screen stylesheet may only lay out (display, grid, flex, gap, sizes, overflow): ${decl}`);
  }
  return out;
}

// ------------------------------------------------------------------ templates
/** An Angular template. `hostBlocks` are the pp- blocks on the component's host element, for the anatomy rule. */
export function checkTemplate(raw, { inDs = false, hostBlocks = [] } = {}) {
  const out = [];
  const report = (index, rule, text) => out.push({ line: lineOf(html, index), rule, text: String(text).trim().slice(0, 160) });
  const html = raw.replace(/<!--[\s\S]*?-->/g, blank);
  html.split('\n').forEach((l, i) => {
    const text = decode(l.replace(/\{\{[^}]*\}\}/g, ''));
    const at = html.split('\n').slice(0, i).join('\n').length + (i ? 1 : 0);
    if (ICON_GLYPHS.test(text)) report(at, 'icons', `glyph or emoji used as an icon, use <svg ppIcon="…">: ${text.match(ICON_GLYPHS)[0]}`);
    if (ARROWS.some((r) => r.test(text))) report(at, 'icons', 'arrow character used as an icon, use <svg ppIcon="arrow-…">');
    if (HEX.test(text.replace(/&#x?[0-9a-f]+;/gi, '').replace(/\[(?:attr\.)?[\w.-]+\]="[^"]*"/g, '')) || COLOR_FN.test(text)) report(at, 'colour', 'raw colour in a template');
  });
  for (const m of html.matchAll(/<(style|script)\b/g)) report(m.index, 'markup', `<${m[1]}> in a template`);
  // Icons: only <svg ppIcon> and <svg ppMark>; names from the vocabulary
  for (const m of html.matchAll(/<svg(?=[\s>/])([^>]*)>/g)) if (!/(?:\bppIcon\b|\[ppIcon\]|\bppMark\b)/.test(m[1])) report(m.index, 'icons', 'hand-written <svg>; use <svg ppIcon="…"> or the mark <svg ppMark>');
  for (const m of html.matchAll(/\s(?:ppIcon|icon|iconAfter|helpIcon|statusIcon)="([^"]*)"/g)) if (m[1] && !VOCAB.has(m[1])) report(m.index, 'icons', `"${m[1]}" is not in the icon vocabulary (icons.json)`);
  for (const m of html.matchAll(/\[(?:ppIcon|icon|iconAfter|helpIcon|statusIcon)\]="'([a-z0-9-]+)'"/g)) if (!VOCAB.has(m[1])) report(m.index, 'icons', `"${m[1]}" is not in the icon vocabulary (icons.json)`);
  // PrimeNG and other kits
  for (const m of html.matchAll(/<(p-[a-z-]+)\b|\s(p[A-Z][A-Za-z]+)(?=[\s=>/])/g)) report(m.index, 'deps', `PrimeNG ${m[1] ? `<${m[1]}>` : m[2]}; use the pp-* component`);
  // Inline styles: only --_* component inputs
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) {
    const bad = m[1].split(';').map((d) => d.trim()).filter(Boolean).filter((d) => !/^--_[\w-]+\s*:/.test(d));
    if (bad.length) report(m.index, 'markup', `style="${bad.join(';').slice(0, 80)}"; only --_* inputs may be set inline`);
  }
  for (const m of html.matchAll(/\[(style(?:\.[\w-]+)?|ngStyle|attr\.style)\]/g)) if (!/^style\.--_/.test(m[1])) report(m.index, 'markup', `[${m[1]}] binding; only [style.--_*] inputs may be bound`);
  // Classes
  const classNames = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean)) classNames.push([m.index, c]);
  for (const m of html.matchAll(/\[class\.([\w-]+)\]/g)) classNames.push([m.index, m[1]]);
  for (const [i, c] of classNames) {
    if (!c.startsWith('pp-')) report(i, 'markup', `class "${c}" is not a Naleko People class`);
    else if (!CLASSES.has(c)) report(i, 'markup', `class "${c}" is not defined by the design system`);
    else if (!inDs && !LAYOUT.test(c)) report(i, 'markup', `class "${c}" belongs to a component; use the pp-* component, or a Layout class`);
  }
  if (!inDs) {
    for (const m of html.matchAll(/<(button|input|textarea|table|select)\b((?:[^>"]|"[^"]*")*)>/g)) {
      const need = NATIVE[m[1]];
      if (!need) report(m.index, 'markup', `<${m[1]}>; use <pp-select>`);
      else if (!need.test(m[2])) report(m.index, 'markup', `<${m[1]}> without its ds directive (${need.source.replace(/\\b|\(\?:|\)/g, '')})`);
    }
  }
  // Anatomy: a part (pp-block__part) only inside its block
  if (inDs) {
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    const open = [new Set(hostBlocks)];
    for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b((?:[^>"]|"[^"]*")*)>/g)) {
      const [, close, tag, attrs] = m;
      if (close) { if (!VOID.has(tag.toLowerCase()) && open.length > 1) open.pop(); continue; }
      const cls = [...((attrs.match(/\sclass="([^"]*)"/) || [, ''])[1]).split(/\s+/), ...[...attrs.matchAll(/\[class\.([\w-]+)\]/g)].map((x) => x[1]), ...[...((attrs.match(/\[class\]="([^"]*)"/) || [, ''])[1]).matchAll(/pp-[a-z0-9-]+?(?=__|--|[^a-z0-9-]|$)/g)].map((x) => x[0])].filter((c) => c.startsWith('pp-'));
      const blocks = new Set(cls.filter((c) => !c.includes('__')).map((c) => c.split('--')[0]));
      for (const c of cls) {
        const i = c.indexOf('__');
        if (i > 0 && !blocks.has(c.slice(0, i)) && !open.some((o) => o.has(c.slice(0, i)))) report(m.index, 'anatomy', `"${c}" outside its block .${c.slice(0, i)}`);
      }
      if (!VOID.has(tag.toLowerCase()) && !attrs.trim().endsWith('/')) open.push(blocks);
    }
  }
  return out;
}

// ------------------------------------------------------------------ TypeScript
/** Pulls inline templates, styles and host classes out of a component file and checks them, plus its imports. */
export function checkTs(raw, { inDs = false, isRegistry = false } = {}) {
  const out = [];
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
  const at = (offset, list) => list.map((v) => ({ ...v, line: v.line + lineOf(code, offset) - 1 }));
  for (const m of code.matchAll(/import\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    if (/^(?:primeng|@primeuix|@primeng)(?:\/|$)/.test(m[1])) out.push({ line: lineOf(code, m.index), rule: 'deps', text: `import from ${m[1]}; Naleko People builds on Angular Aria and the CDK` });
    if (/^(?:lucide|lucide-angular|@lucide\/)/.test(m[1]) && !isRegistry) out.push({ line: lineOf(code, m.index), rule: 'icons', text: `Lucide import outside the icon registry; use <svg ppIcon="…">` });
    if (/^@angular\/material(?:\/|$)/.test(m[1])) out.push({ line: lineOf(code, m.index), rule: 'deps', text: `import from ${m[1]}; Material brings its own look` });
  }
  // Anatomy context: the pp- blocks this file's classes put on their hosts (in host: or a computed()),
  // so a part may sit in a component that its parent block places (a th[ppSortHeader] in a pp-table,
  // a pp-accordion-item in a pp-accordion). Blocks set by a [class] binding count too.
  const outside = code.replace(/template:\s*`[\s\S]*?`/g, '');
  const hostBlocks = [...outside.matchAll(/(?<![\w-])pp-[a-z0-9-]+?(?=__|--|[^a-z0-9-]|$)/g)].map((x) => x[0]);
  // A control that injects its Field renders lines into the field's slot (password strength, a masked
  // value's audit line), so pp-field parts are in their block there.
  if (/inject\(PpField\b/.test(code)) hostBlocks.push('pp-field');
  for (const m of code.matchAll(/template:\s*`([\s\S]*?)`/g)) out.push(...at(m.index + m[0].indexOf('`') + 1, checkTemplate(m[1], { inDs, hostBlocks })));
  for (const m of code.matchAll(/styles?:\s*(?:\[\s*)?`([\s\S]*?)`/g)) out.push(...at(m.index, checkCss(m[1], { feature: !inDs, inDs })));
  // Parts and modifiers written in code (host bindings, computed classes) must exist. Names built up
  // from a prefix ("pp-tag--" + colour) are checked by the gallery, which renders every value.
  if (inDs) {
    const strings = code.replace(/template:\s*`[\s\S]*?`/g, blank);
    for (const m of strings.matchAll(/(?<![\w-])(pp-[a-z0-9-]+(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?)(?![\w$-])/g)) {
      if (/__|--/.test(m[1]) && !m[1].endsWith('-') && !CLASSES.has(m[1])) out.push({ line: lineOf(code, m.index), rule: 'markup', text: `class "${m[1]}" is not defined by the design system` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ project-level checks
export function checkPackage(pkg) {
  const out = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (BANNED_DEPS.test(name)) out.push({ line: 1, rule: 'deps', text: `${name} in ${field}: one look, one icon set (Lucide via the registry), one font pair (Manrope, Inter)` });
  }
  return out;
}

export function checkTokens(dest = DEST, manifest = MANIFEST) {
  const out = [];
  if (!existsSync(manifest)) return [{ line: 1, rule: 'tokens', text: 'no sync.json; run npm run design-system:sync -- <ref>' }];
  const { files } = JSON.parse(readFileSync(manifest, 'utf8'));
  for (const f of owned()) {
    const p = join(dest, f);
    if (!existsSync(p)) out.push({ line: 1, rule: 'tokens', text: `${f} is missing; run the sync` });
    else if (sha256(readFileSync(p, 'utf8')) !== files[f]) out.push({ line: 1, rule: 'tokens', text: `${f} was edited by hand; the design system only changes through npm run design-system:sync` });
  }
  for (const p of walk(dest)) {
    const f = relative(dest, p).split(sep).join('/');
    if (f !== 'sync.json' && !files[f]) out.push({ line: 1, rule: 'tokens', text: `${f} is not from the sync; nothing else lives in src/styles/design-system/` });
  }
  return out;
}

export function checkRegistry(text = readFileSync(REGISTRY, 'utf8')) {
  return text === renderRegistry() ? [] : [{ line: 1, rule: 'icons', text: 'icon.registry.ts is stale; run npm run design-system:sync' }];
}

// ------------------------------------------------------------------ run
export function verify() {
  const found = [];
  const add = (file, list) => found.push(...list.map((v) => ({ file, ...v })));
  add('src/styles/design-system', checkTokens());
  add(rel(REGISTRY), checkRegistry());
  add('package.json', checkPackage(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))));
  for (const f of walk(SRC)) {
    const r = rel(f);
    if (r.startsWith('src/styles/design-system/')) continue;
    const inDs = r.startsWith('src/app/ds/');
    const text = readFileSync(f, 'utf8');
    if (r.endsWith('.spec.ts')) continue;
    if (r.endsWith('.html') && r !== 'src/index.html') add(r, checkTemplate(text, { inDs }));
    else if (r.endsWith('.ts')) add(r, checkTs(text, { inDs, isRegistry: f === REGISTRY }));
    else if (r === 'src/styles.css') { if (text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+"[^"]+";/g, '').trim()) add(r, [{ line: 1, rule: 'styles', text: 'src/styles.css only imports the design system' }]); }
    else if (/\.(?:s?css)$/.test(r)) add(r, checkCss(text, { feature: !inDs, inDs }));
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = verify();
  for (const v of found) console.log(`${v.file}:${v.line} [${v.rule}] ${v.text}`);
  if (found.length) {
    console.log(`\nverify:design: ${found.length} problem${found.length === 1 ? '' : 's'}. How to build UI in Naleko People: src/app/ds/README.md`);
    process.exit(1);
  }
  console.log('verify:design: 0 problems');
}
