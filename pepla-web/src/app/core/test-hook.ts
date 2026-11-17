import { Component, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, type Route } from '@angular/router';
import type { Access } from './nav';
import { landingFor, registerNav } from './nav';
import type { ModulesService } from './modules.service';
import { rolesOf } from './roles';

declare const ngDevMode: boolean | undefined;

type Setup = { entries?: Parameters<typeof registerNav>[0]; routes?: Array<Access & { path: string }> };
const setup = (): Setup | undefined => (globalThis as { __nalekoTestSetup?: Setup }).__nalekoTestSetup;

@Component({ selector: 'app-test-route', template: '<h1>{{ path }}</h1>' })
export class TestRoutePage { protected readonly path = inject(ActivatedRoute).snapshot.data['path'] as string; }

/** Test-only (cards/mod-02.md). The build removes it: every use is behind ngDevMode. */
export function testRoutes(): Route[] {
  if (typeof ngDevMode !== 'undefined' && !ngDevMode) return [];
  return (setup()?.routes ?? []).map((r) => ({
    path: r.path, data: { path: r.path }, component: TestRoutePage,
    canActivate: [(route: never, state: never) => { const env = inject(EnvironmentInjector); return import('./auth/auth.guard').then((m) => runInInjectionContext(env, () => m.accessGuard(r)(route, state))); }],
  }));
}

export function installTestHook(modules: ModulesService): void {
  if (typeof ngDevMode !== 'undefined' && !ngDevMode) return;
  if (setup()?.entries) registerNav(setup()!.entries!);
  (globalThis as { __nalekoTest?: unknown }).__nalekoTest = {
    rolesOf, landingFor, modules: () => [...modules.modules()],
  };
}
