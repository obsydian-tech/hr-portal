# SITE-01

Card: SITE-01 Public routes and prerender in pepla-web, latest design system, no "pepla" visible (NH-203, epic NH-202)

Test files: `site-01.spec.ts`, `support/site-01/public-site.ts`, `support/site-01/kit-parity-contract.ts`

Spec: [NH-203](https://obsydian.atlassian.net/browse/NH-203)

Locks: acceptance-lock/site-01

`/` is the public page for everyone, unknown paths show a not-found page, "Log in" goes to the one sign-in page,
the design system is synced at or after 6c63ab0, no "pepla" reaches public output, and a harness compares an
Angular page with its design system kit screen. These tests add files only; no other card's file changed.

## How the tests run

AC-1, AC-2, AC-3, AC-8, AC-9 and AC-10 run at 1280 and 390 wide. AC-7 is about 390 wide and runs in `phone-390`
only. AC-4, AC-5 and AC-6 run once, in `desktop-1280`: AC-4 builds the app and AC-5 reads files, so the window
does not matter, and the AC-6 harness opens its own widths (1440 and 390). AC-1 and AC-3 also run on pepla-dev.

- AC-1 reads the HTML `ng serve` answers for `/`, opens it with JavaScript off, and opens it signed out while it
  refuses (and records) any Cognito host and the employees and document API hosts named in `src/environments/`.
  The scripts `/` loads must not hold "Register a new employee", "Documents to check", "Set your password",
  "Privacy notice" or `CognitoUserPool`. Route titles count: a title in the eager route file is in a script.
- AC-2 checks that each signed-out address still ends where develop 5d36c1f sends it, that HR and employee pages
  open, and that every "Naleko People home" link in the signed-in shells, hidden ones included, points at `/hr`
  (HR) or `/start` (employee). The shell shows that link on phones only; where it shows, the test clicks it.
- AC-4 runs `npm run build` (a production build, about a minute), checks that npm ran `postbuild` and that it
  said how many files it scanned, puts a page with "pepla" in the real output and expects `npm run postbuild` to
  fail, then plants seven faults one by one in copies of the build under the system temp folder. It removes what
  it planted.
- AC-5 hashes every file `sync.json` lists (as bytes, so a synced image counts too), and fails on any file in
  `src/styles/design-system/` that `sync.json` does not list. "At or after 6c63ab0" is read from the CSS: the
  classes `.pp-site-strip` and `.pp-site-related` first came with 6c63ab0 (#40). The ref must be a full 40-hex sha.
- AC-6 deletes `e2e/parity/.kit/`, runs `npm run parity:kit` (it fetches from GitHub, the only call outside the app
  and Google Fonts in this card), and then calls the harness on the sample below. Planted faults are scripts the test
  adds to the browser context: the brand link moved 4px down, and the brand link renamed "Naleko People start". They
  act only at `/`, so the harness cannot tell a planted run apart.

## AC-6 sample (BA decision, 16 Nov 2026)

Kit `site-header.html`, screens "Header at the top (desktop)" at 1440 and "Header at the top (phone)" at 390, against
SITE-01's own `/`, with `only: [{ role: 'link', name: 'Naleko People home' }]` at both widths. "Sign in" is not the
sample: its kit screen shows a company line and a link the app does not have. The BA asked for "Log in" in the
desktop comparison too, but the kit's desktop "Log in" sits left of "Get started" and "Book a demo" (312px from where
a header with only "Log in" puts it), and those words come with SITE-02. On phones the kit moves "Log in" into the
menu sheet (SITE-02). SITE-02 widens `only` (or drops it) when it re-locks AC-6.

## The kit parity harness (the builder writes it, outside the locked folder)

Module `pepla-web/e2e/parity/kit-parity.ts`, export:

```ts
compareToKit(options: {
  page: Page;       // open the Angular page in this page or another page of page.context(), never a new context
  kitFile: string;  // 'sign-in-and-invite.html'
  screen: string;   // 'Sign in (desktop)'
  path: string;     // '/sign-in'; the kit screen is never opened at this path
  width: number;    // 1440 desktop, 390 phone
  only?: Array<{ role: 'link' | 'button' | 'heading' | 'navigation' | 'banner' | 'img'; name: string }>;
                    // compare only these (visible, exact accessible name) and what is inside them; pixels only
                    // inside their kit boxes; missing on the page goes in unmatched, missing on the kit is an error
}): Promise<{
  pass: boolean;        // true only when unmatched and moved are empty and pixelRatio <= 0.01
  kitRef: string;       // ref in src/styles/design-system/sync.json
  kitPath: string;      // absolute path of the kit file read, inside e2e/parity/.kit/
  width: number;        // the width both were opened at
  kitElements: number;  // kit elements compared (the sample needs 10 or more)
  unmatched: string[];  // kit elements with no page element of the same tag, pp- classes and own text
  moved: string[];      // matched elements whose x, y, width or height differs by more than 1px
  pixelRatio: number;   // share of differing pixels, 0 to 1
}>
```

`npm run parity:kit` fetches the kit files for the ref in `sync.json` into `e2e/parity/.kit/`, which git ignores.
The harness uses the app's own synced stylesheet, freezes motion, and calls nothing but the app and Google Fonts.

Harness rules the spec leaves open (BA, 16 Nov 2026), as the throwaway did them:
- a `<span>` with no class inside an element that has no text of its own counts as that element's text;
- the screen's outer element fills the kit frame, so its height is not compared (its x, y and width are);
- input values on the kit screen are typed into the page's fields, in order, before measuring;
- the kit page's body has margin 0, and a kit site frame (`pp-site-frame`, `pp-site-frame__page`) is laid out at the
  window width with no scaling or clipping, since the frame is only the kit's preview.
The full contract, with the planted faults, is `support/site-01/kit-parity-contract.ts`.

## Later cards

SITE-02 to SITE-04 put words and sections on `/`. AC-7's header check and AC-9 ("only Log in and Naleko People")
hold for this card's empty shell; a card that adds visible words to `/` re-locks those tests under its own card,
as ONB-01.1 did.
