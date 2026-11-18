# SITE-15 · Book a demo and Get started forms (screens only)

Jira NH-220, epic NH-202 (public site). Tier: amber. Spec: `/mnt/project-files/onboarding-cards/specs/SITE-15.md`.
Lock: `acceptance-lock/site-15`. Build branch: `feat/site-15-forms`. No backend. Every test is red on develop until the forms are built.

Files: `e2e/acceptance/site-15.spec.ts`, `support/site-15/forms.ts` (kit oracle, gallery, stand-in hook, page-side checks), `support/site-15/build.ts`
(AC-7 build read), `support/site-15/files.ts` (AC-9 file rule), this card. The SITE-08 kit helpers (`support/site-08/kit.ts`) are imported, never edited.

## The oracle

The design system kit "Site form pages", `project/ui_kits/site-form.html` with its preview script `scripts/preview/site-form.js`, at ref
`dee75b046aa8330912e1fd5f5c6ee072c736997a` (coordinator 18 Nov: dee75b0 or later; it removed two Recruitment claims, which these files do not
hold). `site-form.html`, `site-form.js`, `site-sections.js` and `site.css` are byte for byte the same at dee75b0, at dc593c4 (SITE-09/10) and at the
app's `sync.json` ref c3788a5. Tab titles: the tests pin no title; AC-7 only asks that /book-a-demo and /get-started have the not-found page's title,
whatever it is (Iggie 18 Nov: "<Page name> · Naleko People", home "Naleko People"). Override with `SITE_15_KIT_REF`. The kit's 11 examples: Get started empty, with errors, filled in, sent; Book a demo empty, sent (desktop);
Get started empty, with errors, sent; Book a demo empty, sent (phone).

**The "free" lines.** Iggie (17 Nov): the lines that say "free" are not shown until he sends reworded lines, and the kit loses them first. On 18 Nov no
design system branch has removed them (checked: every branch's `site-form.html` still has 22 matches). So the tests take them out of the kit
themselves (`FREE_CUTS` in forms.ts), whole element or whole sentence, and the builder follows the cut kit:

1. the fact chip "Free company account" (Get started),
2. the first sentence of the Get started lead, "The company account is free." (the rest of the lead stays),
3. the Book a demo confirmation line "Ready to begin before the demo? Create a free company account. Modules are switched on after the onboarding call." (whole paragraph),
4. the Book a demo next step "The next step: If the company wants to go ahead, the Administrator creates a free company account and books the onboarding call." (whole item).

Cut 4 is not one of the three lines Iggie named, but AC-1 allows no "free" anywhere, so it goes too. When the design system PR lands, its cuts must
equal these (or the tests are re-pinned in a child lock). A kit that still says "free" after the cuts makes every test fail with the reason.

## Builder contract (what the tests read)

- Gallery route `/dev/site-forms` in `app.routes.ts`, lazy, `canActivate: [siteStyles]`. No `/book-a-demo` or `/get-started` route anywhere, no prerender entry.
- One `section[data-example="<kit example> (<device>)"]` per kit example, in the kit's order, `id="form-<kebab of the example>-<device>"`, e.g.
  `form-get-started-empty-desktop`, `form-book-a-demo-sent-phone`. Inside it one `[data-example-body]` holding one `.pp-site-stage` that holds what the
  kit example holds (the header, the form page). The static examples (with errors, filled in, sent) show the kit's state and values.
- The forms live in `src/app/ds/site/forms/` (AC-9 reads that folder). It declares `SiteFormSender` with
  `send(kind, values): Promise<'sent' | 'failed'>` (decision 2). The gallery uses a stand-in.
- **Stand-in hook.** On every `send(kind, values)` the stand-in reads `window.__ppSiteFormStandIn`. If it is there: push `{ kind, values }` onto its
  `calls`, wait `delayMs` (if set), answer `answer` (default `'sent'`). If it is not there: answer `'sent'`. `kind` is `'get-started'` or `'book-a-demo'`;
  `values` holds what was typed (the tests look for the typed email in it). No network call, no storage. The tests set `window.__ppSiteFormStandIn = { answer, delayMs, calls: [] }` before any page script runs and read `calls` afterwards: the stand-in reads the object at every send (never earlier, never a copy), pushes onto that same `calls` array and does not replace the object. A stand-in that ignores the object (no `calls`, no delay, always 'sent') fails AC-3, AC-5 and AC-6.
- Day slots: the next five working days (Mon to Fri) in South African time, today included, as "Tue 17 Nov"; the kit's five times. The second day and
  the second time start picked, as in the kit. Tests freeze the clock with Playwright's `clock.setFixedTime` (Mon 16 Nov 2026 09:00 SAST).
- Required controls carry `required` and `aria-required="true"`. Email is `type="email"` with no `pattern`.
- Day and time rows: a group named "Day" / "Time" (`role="radiogroup"` or the kit's `role="group"`), one choice on; ArrowRight/ArrowLeft move the
  choice and the focus. Each choice is either `role="radio"` with `aria-checked` in a `role="radiogroup"` row (then the pressed look must still be the kit's) or the kit's
  `button[aria-pressed]` in the kit's `role="group"` row. Not both on one element, and not a mix (a radio in a plain group, pressed buttons in a radiogroup). The form's controls, groups and buttons must carry the kit's roles and accessible names (checked on the accessibility tree; a radio counts as the kit's pressed button).
- Send: errors as the kit's preview script shows them (`aria-invalid`, the error line shown and linked by `aria-describedby`, focus on the first
  field in error). While waiting for the sender the submit button has `aria-busy="true"`; a second press while waiting sends nothing. On `'sent'`
  the form is hidden, the confirmation shows the typed email and picked "day, time", and focus goes to the confirmation heading (focus on the
  `.pp-site-confirm` box, as the kit does, is also accepted). On `'failed'` the form stays as filled, nothing says it worked, no new words.
- Nothing typed goes to storage, cookies, the console or any request, and from the first Send on the gallery makes no POST, no fetch or XHR, no beacon and no page load. `src/app/ds/site/forms/` (not its specs) holds no `fetch(`, `XMLHttpRequest`, `sendBeacon`, `HttpClient`, `WebSocket`, `EventSource`, storage, `document.cookie`, `indexedDB`, Cognito or amplify code and no import from `core/`, `features/` or `environments/`: the real sender is the later card's.
- Files: only `src/app/ds/site/` (the forms folder and what it needs there), `src/app/app.routes.ts` (the gallery route) and the site tests. Not `features/public/`, not `site.routes.ts`, not `app.routes.server.ts`: this card adds no public page, no public route and no prerender entry.

## What each test judges

| AC | Judged | How |
|---|---|---|
| 1 | gallery holds the 11 examples (ids, order); words both ways per example; no "free", lorem, placeholder, Masked, Claude, pepla | rendered text nodes and names (hidden parts left out); in "sent" the email and slot spans are left to AC-5 |
| 2 | each example: boxes 1px, pixels 1% (SITE-08 `compareScopes`), clock frozen; CSS motion of every element equals the kit's (normal and reduced motion); the live form filled with the kit's values equals the kit's "filled in" picture | closed `<option>` boxes are left out of the box list (Chrome gives them the window's corner) |
| 3 | controls by label, labels visible and tied; required + aria-required; type=email, Gmail and Outlook are sent; selects with the kit's options; chips are toggle buttons in the kit's named group; Day/Time single choice, click, ArrowRight/Left; days for two other dates seen from Los Angeles | live form, kit beside it |
| 4 | Send with nothing: the same errors, messages and focus as the kit does; nothing sent; bad email message; each fix clears its own message at once, values kept; the error state equals the kit's "with errors" picture | both pages driven the same way |
| 5 | double press plus a third press while waiting send once; aria-busy while waiting; confirmation heading, focus, form gone; the result equals the kit's "sent" picture; typed email and picked slot shown; failed answer keeps the form and its values | stand-in hook |
| 6 | no host but the app and Google Fonts; no typed value in storage, cookies, console or any request; sends tried in both answers | control: the stand-in was called |
| 7 | the forms exist (no vacuous pass); /book-a-demo and /get-started show the not-found page; no route file names them; the build has no page for them | desktop once |
| 8 | at 390 one column, card right after lead and facts (gap as kit), next steps after; every button and heading visible after scrolling through, inside the width, not under the header; no sideways scroll; axe WCAG 2.1 A/AA on every example and on the live error and sent states; one h1 | |
| 9 | file rule = SITE-09 AC-12's list without its public-page and public-route files, plus `app.routes.ts`; the forms folder holds no network, storage or signed-in code; repository state (forms folder, SiteFormSender, gallery route); /sign-in and /hr load no site code | desktop once; the file rule skips a PR that changes none of this card's files |

## Where the tests differ from the spec (for the BA)

1. **"free" lines**: cut by the tests (above), because the design system change has not been made. Cut 4 (Book a demo next step) is extra.
2. **AC-3 radio groups**: the spec says "radio groups (SITE-08 choices)". The kit and SITE-08 draw slots as `button[aria-pressed]` in a `role="group"`,
   and the pressed look in `site.css` is keyed to `aria-pressed`. The tests accept either true radios (`aria-checked`) or the kit's buttons, and require
   the radio behaviour either way (one on, arrow keys move choice and focus).
3. **AC-5 focus**: the kit focuses the confirmation box (`.pp-site-confirm`, tabindex -1), the spec says its heading. Both are accepted.
4. **AC-5 busy**: the kit has no busy look; the tests read `aria-busy="true"` on the submit button and no new words.
5. **AC-3 required**: the consent box is not `required` in the kit (only `data-req`); the tests ask `required` + `aria-required` for the kit's
   `required` text fields and selects. The consent box's error is judged in AC-4.
6. **AC-1 "except the typed email and picked slot"**: the gallery's static "sent" examples are still judged against the kit by AC-2 (boxes and
   pixels), so they show the kit's sample email and slot.
