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

## The pepla-dev address (OPS-01)

Every merge into `develop` builds the app against pepla-dev and copies it to a private S3 bucket behind CloudFront (`infra/web-dev.tf`, copied by the "Naleko People dev" steps of the "Deploy to pepla-dev" job in `.github/workflows/deploy-lambdas.yml`). The address is the `web_dev_address` Terraform output; `scripts/ci/dev-web-address.sh` prints it from a pepla-dev session. It is a plain `https://<id>.cloudfront.net` address with no domain yet, and it asks search engines to stay away.

- **Sign in** with the HR test login (the fake people from the seed): in the AWS console, pepla-dev account, region Cape Town, Secrets Manager, `pepla-dev/e2e/hr`, "Retrieve secret value". Nobody pastes the password anywhere.
- **AI is skipped** for that login (it is in `e2e-robots`), so nothing calls a paid model. A test run can reset the fake people's documents while you are clicking.
- **Pages:** `/` and any route listed in `app.routes.server.ts` are prerendered files. `/hr`, `/sign-in` and every other address open the app shell, which shows the right page in the browser.
- **After a merge** the new app's `@pepla-dev` acceptance tests run against this address once the APIs allow it (`web_dev_origin` in `infra/apigateway.tf`; the workflow switch is `on_web_address`). Pull requests have no address of their own and keep using `ng serve` on port 4300.
- Prod is not hosted this way yet (OPS-04, SITE-06). Invite and sign-in links in dev emails still point at `http://localhost:4300`.

## Rules for building screens

- Read `src/app/ds/README.md` first. Screens use only `pp-*` components from `src/app/ds` and Layout classes.
- `npm run verify:design` runs before every build and in CI. It has no escape hatch: no ignore comments, no allowlist and no baseline. Fix the screen, or add the missing piece to `src/app/ds`.
- `npm run test:design` gives each verify rule a fixture that must fail. A new rule needs a new fixture.
- Never edit `src/styles/design-system/` or `src/app/ds/core/icon.registry.ts`. Change the design system repo, then run `npm run design-system:sync`. Site styles (`site.css`) load only on public pages: the app's own stylesheet is `platform.css`, and routes that show site parts add the `siteStyles` guard. Against a local checkout, use `-- --from ../../pepla-design-system`.
- No PrimeNG, Angular Material, Tailwind, PrimeFlex or second icon set.
- Check `/dev/design-system` in a browser after any change in `src/app/ds`.
