import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * SITE-01: only `/` is prerendered. Everything else (the signed-in app, sign-in, and any unknown
 * address, which shows the not-found page) renders in the browser from the app shell, so Cognito and
 * the APIs never run at build time.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
