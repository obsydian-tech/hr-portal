import { Injectable, OnDestroy, computed, signal } from '@angular/core';

interface NetworkInformation extends EventTarget {
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  downlink: number;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  private readonly _isOnline        = signal(navigator.onLine);
  private readonly _isSlowConnection = signal(this.detectSlow());

  readonly isOnline         = this._isOnline.asReadonly();
  readonly isSlowConnection = this._isSlowConnection.asReadonly();
  readonly showBanner       = computed(() => !this._isOnline() || this._isSlowConnection());
  readonly bannerMessage    = computed(() => {
    if (!this._isOnline()) return 'You are offline. Changes may not be saved.';
    if (this._isSlowConnection()) return 'Slow connection detected. Some content may load slowly.';
    return '';
  });

  private readonly onOnline  = () => { this._isOnline.set(true); this._isSlowConnection.set(this.detectSlow()); };
  private readonly onOffline = () => this._isOnline.set(false);
  private readonly onConnChange = () => this._isSlowConnection.set(this.detectSlow());

  constructor() {
    window.addEventListener('online',  this.onOnline);
    window.addEventListener('offline', this.onOffline);

    const conn = this.connection();
    conn?.addEventListener('change', this.onConnChange);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online',  this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.connection()?.removeEventListener('change', this.onConnChange);
  }

  private connection(): NetworkInformation | undefined {
    return (navigator as unknown as { connection?: NetworkInformation }).connection;
  }

  private detectSlow(): boolean {
    const conn = this.connection();
    if (!conn) return false;
    return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.downlink < 0.5;
  }
}
