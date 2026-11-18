import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * SITE-01: `/` is prerendered, and since SITE-09 so is `/product/recruitment` and since SITE-10 `/product/onboarding` (a public Learn more page). Everything else (the signed-in app, sign-in, and any unknown
 * address, which shows the not-found page) renders in the browser from the app shell, so Cognito and
 * the APIs never run at build time.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'product/recruitment', renderMode: RenderMode.Prerender },
  { path: 'product/onboarding', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
