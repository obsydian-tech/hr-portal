// Parity check: each design system example next to its Angular version, compared by rendered
// structure and by pixels. Dev tool, not part of the build.
//   DS:  the design system's built component pages (dist/components/<slug>.html), light stage
//   App: /dev/parity, sections <section data-parity="<slug>|<example title>">
// Usage: node scripts/parity.cjs <ds-base-url> <app-url> <out-dir> [slug filter]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [DS, APP, OUT, ONLY] = process.argv.slice(2);
const WIDTH = 720;
const STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

// A rendered element as one line: tag (any pp-* host counts as a plain element), pp- classes, role,
// state attributes, and its own text. Hidden elements and wrapper hosts with no class are skipped.
function signature(root) {
  const lines = [];
  const inherited = new Map();
  const icon = (svg) => { const p = svg.querySelector('path,circle,rect,line,polyline'); if (!p) return ''; if (p.getAttribute('d')) return p.getAttribute('d').slice(0, 24); return p.tagName + [...p.attributes].map((a) => a.name + '=' + a.value).sort().join(' ').slice(0, 40); };
  const walk = (el, depth) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        if (t) lines.push(`${'  '.repeat(depth)}"${t}"`);
        continue;
      }
      if (node.nodeType !== 1) continue;
      const n = node;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.classList.contains('cdk-focus-trap-anchor')) continue; // focus trap anchors are empty and hidden
      const tag = n.tagName.toLowerCase();
      const classes = [...n.classList].filter((c) => c.startsWith('pp-') || c === 'lucide').sort();
      const custom = tag.includes('-');
      if (custom && !classes.length && !n.getAttribute('role')) { walk(n, depth); continue; } // transparent wrapper
      // A component host that only carries Layout classes from the screen (pp-measure-form on <pp-description-list>)
      // counts as those classes on its one inner element, as the design system writes them.
      const LAYOUT = /^pp-(measure-|grow|fixed|push|shrink|gap-|width-field-)/;
      const kids = [...n.children].filter((k) => getComputedStyle(k).display !== 'none');
      if (custom && classes.length && classes.every((c) => LAYOUT.test(c)) && !n.getAttribute('role') && kids.length === 1) {
        inherited.set(kids[0], classes); walk(n, depth); continue;
      }
      if (inherited.has(n)) classes.push(...inherited.get(n)), classes.sort();
      const attrs = [];
      // Form state is read from properties: Angular sets checked, value and the like as properties, not attributes.
      const control = /^(input|select|textarea|button|option)$/.test(tag);
      const PROPS = { disabled: 'disabled', readonly: 'readOnly', required: 'required', checked: 'checked', value: 'value' };
      for (const a of ['role', 'type', 'aria-label', 'aria-current', 'aria-pressed', 'aria-busy', 'aria-expanded', 'aria-selected', 'aria-hidden', 'aria-invalid', 'aria-modal', 'aria-sort', 'disabled', 'readonly', 'required', 'checked', 'open', 'target', 'datetime', 'colspan', 'scope', 'value', 'max', 'placeholder']) {
        if (control && a in PROPS && tag !== 'button' && tag !== 'option') {
          const v = n[PROPS[a]];
          if (a === 'value') { if (v && n.type !== 'checkbox' && n.type !== 'radio') attrs.push(`value=${tag === 'select' ? n.selectedOptions[0]?.text.trim() : v}`); } // a select shows its chosen words; option values are ids
          else if (v) attrs.push(`${a}=`);
        } else if (tag === 'option' && a === 'value') { /* data, not markup */
        } else if (a === 'aria-hidden' && n.parentElement?.closest('[aria-hidden="true"]')) { /* already hidden by an ancestor: same for screen readers */
        } else if (n.hasAttribute(a) && !(custom && !a.startsWith('aria-') && a !== 'role')) attrs.push(`${a}=${n.getAttribute(a)}`); // a component's inputs are not markup
      }
      for (const a of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for', 'href']) if (n.hasAttribute(a)) attrs.push(`${a}`);
      const t = custom || tag === 'span' || tag === 'div' ? '~' : tag; // span, div and component hosts are all plain boxes
      if (tag === 'svg') { lines.push(`${'  '.repeat(depth)}svg.${classes.join('.')} ${icon(n)}`); continue; }
      lines.push(`${'  '.repeat(depth)}${t}${classes.length ? '.' + classes.join('.') : ''}${attrs.length ? ' [' + attrs.join(' ') + ']' : ''}`);
      // A textarea's words: the design system writes them as text, Angular sets the value.
      if (tag === 'textarea') { if (n.value.trim()) lines.push(`${'  '.repeat(depth + 1)}"${n.value.trim()}"`); continue; }
      walk(n, depth + 1);
    }
  };
  walk(root, 0);
  return lines;
}

// Pixel compare in a canvas: share of pixels whose channels differ by more than 24, and size difference.
async function pixels(page, a, b) {
  const enc = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  return page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
    const data = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#f0f'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = data(A), db = data(B); let bad = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) bad++;
    return { ratio: +(bad / (w * h)).toFixed(4), ds: [A.width, A.height], app: [B.width, B.height] };
  }, [enc(a), enc(b)]);
}

// A signature line without the element's name and the roles that only restate it.
function soften(line) {
  return line
    .replace(/^(\s*)(header|footer|article|aside|nav|section|main|p|ul|ol|li|h[1-6]|dl|time|label|strong)(?=[.\s\[]|$)/, '$1~')
    .replace(/\b(role=(heading|article|list|listitem|banner|region|group|none|navigation|contentinfo|complementary)|aria-level=\d|type=text)\b ?/g, '')
    .replace(/ \[ *\]$/, '').replace(/ \[ +/, ' [').replace(/ +\]/, ']');
}

// Line diff (LCS) between two signature lists.
function diff(a, b) {
  const A = a.map((l) => l.trim()), B = b.map((l) => l.trim());
  const m = A.length, n = B.length, dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && A[i] === B[j]) { i++; j++; }
    else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) out.push(`+ app  ${b[j++]}`);
    else out.push(`- ds   ${a[i++]}`);
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${APP}/dev/parity`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: `[data-parity]{width:${WIDTH}px;box-sizing:border-box;padding:24px;background:var(--elevation-surface);border:1px solid transparent}${STILL}` });
  const sections = await page.$$eval('[data-parity]', (els) => els.map((e) => e.getAttribute('data-parity')));
  const report = [];
  const cmp = await browser.newPage();
  const dsPages = {};
  for (const key of sections) {
    const [slug, title] = key.split('|');
    if (ONLY && !slug.includes(ONLY)) continue;
    const app = page.locator(`[data-parity="${key.replace(/"/g, '\\"')}"]`);
    const appSig = await app.evaluate(signature);
    const shotApp = path.join(OUT, `${slug}--${title.replace(/[^a-z0-9]+/gi, '-')}--app.png`);
    // Sections lower on the page can start at a fractional y; clip to whole pixels so that offset is not a difference.
    await app.scrollIntoViewIfNeeded();
    const box = await app.boundingBox();
    await page.screenshot({ path: shotApp, clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } });
    // Design system side
    const ds = dsPages[slug] ?? (dsPages[slug] = await browser.newPage({ viewport: { width: 1400, height: 1000 } }));
    if (!ds.url().endsWith(`${slug}.html`)) {
      await ds.goto(`${DS}/components/${slug}.html`, { waitUntil: 'networkidle' });
      await ds.addStyleTag({ content: `.stage{width:${WIDTH}px!important;box-sizing:border-box;padding:24px!important;border:1px solid transparent!important;border-radius:0!important}.stage>.lbl{display:none!important}.stage[data-theme="dark"]{display:none!important}.pair{display:block!important}${STILL}` });
    }
    const exIndex = await ds.$$eval('.ex > h3', (hs, t) => hs.findIndex((h) => h.textContent.trim() === t), title);
    if (exIndex < 0) { report.push({ key, problem: 'no such example in the design system' }); continue; }
    const stage = ds.locator('.ex').nth(exIndex).locator('.stage[data-theme="light"]');
    const dsSig = await stage.evaluate(signature);
    const shotDs = shotApp.replace('--app.png', '--ds.png');
    await stage.screenshot({ path: shotDs });
    const d = diff(dsSig, appSig);
    const px = await pixels(cmp, shotDs, shotApp);
    // The same once element names are set aside: a host or <div> where the design system writes <header>, <article> or <h3>
    // (with the matching role), list items as hosts. Reported apart, so real differences stand out.
    const loose = diff(dsSig.map(soften), appSig.map(soften));
    report.push({ key, same: d.length === 0 && px.ratio < 0.002, tagsOnly: d.length > 0 && loose.length === 0 && px.ratio < 0.01, px, diff: d });
  }
  // Coverage: every design system example should have an app section.
  const have = new Set(sections);
  const missing = [];
  const list = await browser.newPage();
  for (const f of fs.readdirSync(process.env.DS_DIST || require('path').resolve(__dirname, '../../../pepla-design-system/dist/components')).filter((f) => f.endsWith('.html') && f !== 'index.html')) {
    const slug = f.slice(0, -5);
    if (ONLY && !slug.includes(ONLY)) continue;
    await list.goto(`${DS}/components/${f}`);
    for (const t of await list.$$eval('.ex > h3', (hs) => hs.map((h) => h.textContent.trim()))) if (!have.has(`${slug}|${t}`)) missing.push(`${slug}|${t}`);
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ errors, missing, report }, null, 2));
  const bad = report.filter((r) => !r.same && !r.tagsOnly);
  const tags = report.filter((r) => r.tagsOnly);
  for (const r of bad) {
    console.log(`\n## ${r.key}${r.problem ? ': ' + r.problem : ''}${r.px ? `  pixels ${(r.px.ratio * 100).toFixed(2)}% ds ${r.px.ds} app ${r.px.app}` : ''}`);
    for (const l of (r.diff || []).slice(0, 40)) console.log(l);
    if ((r.diff || []).length > 40) console.log(`… ${r.diff.length - 40} more`);
  }
  console.log(`\n${report.length - bad.length - tags.length} of ${report.length} examples match exactly, ${tags.length} more differ only in element names. ${missing.length} design system examples have no app section yet. Console errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  await browser.close();
})();
