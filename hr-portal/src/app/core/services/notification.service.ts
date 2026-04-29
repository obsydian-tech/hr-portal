import { Injectable, computed, signal, inject, OnDestroy } from '@angular/core';
import { HrApiService } from './hr-api.service';
import { Verification } from '../../shared/models/employee.model';

/**
 * Service to manage notification data for MANUAL_REVIEW documents.
 * Polls the verification API every 2 minutes to keep notification count fresh.
 */
@Injectable()
export class NotificationService implements OnDestroy {
  private readonly hrApi = inject(HrApiService);
  private pollInterval?: number;
  
  // ─── State Signals ───────────────────────────────────────
  
  /** All verifications fetched from API */
  private readonly allVerifications = signal<Verification[]>([]);
  
  /** Loading state for initial fetch and refreshes */
  readonly loading = signal<boolean>(false);
  
  /** Error state if API call fails */
  readonly error = signal<string | null>(null);
  
  // ─── Computed Signals ────────────────────────────────────
  
  /** Verifications that need manual review (MANUAL_REVIEW decision) */
  readonly notifications = computed(() => 
    this.allVerifications().filter(v => v.decision === 'MANUAL_REVIEW')
  );
  
  /** Count of documents pending manual review */
  readonly notificationCount = computed(() => this.notifications().length);
  
  /** Most recent 5 notifications for dropdown preview */
  readonly recentNotifications = computed(() => {
    const all = this.notifications();
    // Sort by created_at descending (most recent first)
    const sorted = [...all].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return sorted.slice(0, 5);
  });
  
  // ─── Lifecycle ───────────────────────────────────────────
  
  constructor() {
    // Fetch initial data
    this.refreshNotifications();
    // Start polling every 2 minutes (120,000 ms)
    this.startPolling();
  }
  
  ngOnDestroy(): void {
    this.stopPolling();
  }
  
  // ─── Public Methods ──────────────────────────────────────
  
  /**
   * Manually trigger a refresh of notification data.
   * Called on init, by polling, or manually by components.
   */
  refreshNotifications(): void {
    this.loading.set(true);
    this.error.set(null);
    
    // Get staff ID from localStorage (set during HR login/navigation)
    const staffId = this.getStaffIdFromUrl();
    
    this.hrApi.getVerifications(staffId).subscribe({
      next: (response) => {
        this.allVerifications.set(response.items);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch verifications for notifications:', err);
        this.error.set('Failed to load notifications');
        this.loading.set(false);
      },
    });
  }
  
  // ─── Private Methods ─────────────────────────────────────
  
  private startPolling(): void {
    // Poll every 2 minutes (120,000 ms)
    this.pollInterval = window.setInterval(() => {
      this.refreshNotifications();
    }, 120_000);
  }
  
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }
  
  /**
   * Extract staff ID from current URL path (/hr/:staffId/...)
   * Fallback to localStorage if available
   */
  private getStaffIdFromUrl(): string {
    const path = window.location.pathname;
    const match = path.match(/\/hr\/([^\/]+)/);
    if (match?.[1]) {
      return match[1];
    }
    // Fallback to localStorage (if set elsewhere in the app)
    return localStorage.getItem('hr_staff_id') || '';
  }
}
