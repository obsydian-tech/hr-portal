import { Injectable, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from './auth/auth.service';

const MINUTE = 60_000;

/** The company's modules (GET /v1/company/modules). Fails closed: empty until the first good answer, and after any failure. */
@Injectable({ providedIn: 'root' })
export class ModulesService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly modules = signal<ReadonlySet<string>>(new Set());
  private okAt = 0;
  private inflight: Promise<void> | null = null;
  private failedNav = -1;

  constructor() {
    this.router.events.subscribe((e) => { if (e instanceof NavigationEnd && this.auth.user()) void this.ensure(e.id); });
    effect(() => { if (!this.auth.user()) this.clear(); });
  }

  clear(): void {
    this.modules.set(new Set());
    this.okAt = 0;
  }

  ensure(navId: number): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this.okAt && Date.now() - this.okAt < MINUTE) return Promise.resolve();
    if (navId === this.failedNav) return Promise.resolve();
    this.inflight = this.load(navId).finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async load(navId: number): Promise<void> {
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('no sign-in');
      const res = await fetch(`${environment.employeesApiUrl}/v1/company/modules`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body: unknown = await res.json();
      const list = (body as { modules?: unknown } | null)?.modules;
      if (!Array.isArray(list) || !list.every((m) => typeof m === 'string')) throw new Error('bad body');
      if (!this.auth.user()) return;
      this.modules.set(new Set(list as string[]));
      this.okAt = Date.now();
    } catch {
      this.clear();
      this.failedNav = navId;
    }
  }
}
