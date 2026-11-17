# pepla-web

The new Naleko People web app: Angular 22 with signals and no zone.js. It uses only `pp-*` components from `src/app/ds`, which are built from the Naleko People design system (obsydian-tech/pepla-design-system). There is no PrimeNG; the hard controls use `@angular/aria` and `@angular/cdk`.

The old app in `../hr-portal` keeps running on Vercel until this one replaces it.

| Command | What it does |
| --- | --- |
| `npm ci` | Install |
| `npm start` | Dev server on http://localhost:4200 |
| `npm test` | verify:design fixtures, then unit tests (Vitest) |
| `npm run build` | verify:design, then a production build |
| `npm run design-system:sync -- v1.0.0` | Pin the design system styles and icons to a tag |

Pages for checking the components:

- `/dev/design-system`: every component, with live versions of the interactive ones.
- `/dev/parity`: each design system example rebuilt with the Angular components. `node scripts/parity.cjs <design system URL> <app URL> <out dir>` compares the two by structure and pixels.

## Public routes (SITE-01)

`/` and the not-found page are public, prerendered at build time (`src/app/site.routes.ts`, `app.routes.server.ts`); every signed-in page loads lazily from `app.routes.ts` and renders in the browser.
`npm run build` runs `verify-public-names` after the build (no "pepla" in public output), and `npm run parity:kit` fetches the kit screens for `e2e/parity/kit-parity.ts`.

## Rules for building screens

- Read `src/app/ds/README.md` first. Screens use only `pp-*` components from `src/app/ds` and Layout classes.
- `npm run verify:design` runs before every build and in CI. It has no escape hatch: no ignore comments, no allowlist and no baseline. Fix the screen, or add the missing piece to `src/app/ds`.
- `npm run test:design` gives each verify rule a fixture that must fail. A new rule needs a new fixture.
- Never edit `src/styles/design-system/` or `src/app/ds/core/icon.registry.ts`. Change the design system repo, then run `npm run design-system:sync`. Site styles (`site.css`) load only on public pages: the app's own stylesheet is `platform.css`, and routes that show site parts add `provideSiteStyles()`. Against a local checkout, use `-- --from ../../pepla-design-system`.
- No PrimeNG, Angular Material, Tailwind, PrimeFlex or second icon set.
- Check `/dev/design-system` in a browser after any change in `src/app/ds`.
