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
  /** Counts reads, so an answer from an older read never overwrites a newer one. */
  private reads = 0;

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
    return this.track(this.load(navId));
  }

  /** Remembers the read in flight (a navigation that ends meanwhile joins it) and forgets it when it is done. */
  private track(read: Promise<boolean>): Promise<void> {
    const mine: Promise<void> = read.then(() => undefined).finally(() => { if (this.inflight === mine) this.inflight = null; });
    this.inflight = mine;
    return mine;
  }

  /**
   * CHAT-03: forgets the cache and reads the company's modules again, whatever is in flight. Says whether the read worked.
   * After a failure the list is empty (fails closed).
   */
  async refresh(): Promise<boolean> {
    this.okAt = 0;
    const read = this.load(null);
    void this.track(read);
    return read;
  }

  /** Reads the modules. `navId` is the navigation that asked (a failed read is not retried within it); null for refresh(). */
  private async load(navId: number | null): Promise<boolean> {
    const mine = ++this.reads;
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('no sign-in');
      const res = await fetch(`${environment.employeesApiUrl}/v1/company/modules`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body: unknown = await res.json();
      const list = (body as { modules?: unknown } | null)?.modules;
      if (!Array.isArray(list) || !list.every((m) => typeof m === 'string')) throw new Error('bad body');
      if (!this.auth.user() || mine !== this.reads) return false;
      this.modules.set(new Set(list as string[]));
      this.okAt = Date.now();
      return true;
    } catch {
      if (mine !== this.reads) return false;
      this.clear();
      if (navId !== null) this.failedNav = navId;
      return false;
    }
  }
}
