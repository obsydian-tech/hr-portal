/**
 * IntelligenceService — Phase 6.2.4
 *
 * Service for fetching and managing intelligence tiles.
 * Tiles are projections over signal snapshots (§10.2).
 *
 * Pattern: Observable-based API service (matches TalentFlowApiService)
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, map, of, switchMap, throwError, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import {
  IntelligenceTile,
  IntelligenceTilesResponse,
  SignalSnapshot,
  SignalSnapshotFilters,
  SignalSnapshotResponse,
  HiringStage,
} from '../models/talent-flow.models';
import { STAGE_LABELS } from '../components/stage-selector/stage-selector.component';

const API_TIMEOUT_MS = 15_000;

// Signal thresholds for tile generation
const TILE_THRESHOLDS = {
  SLA_BREACH_DAYS: 0,           // Breached = critical
  SLA_AT_RISK_DAYS: 3,          // At risk threshold
  DAYS_STALE: 14,               // Candidate stale after 14 days
  FINAL_SCORE_HIGH: 85,         // High performer threshold
  OFFER_EXPIRY_URGENT: 3,       // Urgent if expiring in 3 days
  ENGAGEMENT_LOW: 40,           // Low engagement score
};

// Tile priority labels
const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

@Injectable({ providedIn: 'root' })
export class IntelligenceService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  // ── Client-side state (signal-based for reactive UI) ──────────────────────
  private readonly _tiles = signal<IntelligenceTile[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly tiles = this._tiles.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // Computed signals for dashboard zones
  readonly tilesCount = computed(() => this._tiles().length);
  readonly criticalTiles = computed(() =>
    this._tiles().filter(t => t.priority === 'CRITICAL'),
  );
  readonly criticalCount = computed(() => this.criticalTiles().length);
  readonly highTiles = computed(() =>
    this._tiles().filter(t => t.priority === 'HIGH'),
  );
  readonly highCount = computed(() => this.highTiles().length);
  readonly hasTiles = computed(() => this._tiles().length > 0);

  private get baseUrl(): string {
    return environment.talentFlow.apiUrl;
  }

  /** Resolves the Cognito ID token then returns HttpHeaders with Bearer auth. */
  private authHeaders(): Observable<HttpHeaders> {
    return from(this.authService.getIdToken()).pipe(
      switchMap((token) => {
        const headers = new HttpHeaders({
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        });
        return [headers];
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API Methods (Observable-based)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch signal snapshots for the current user
   * GET /v1/intelligence/snapshots?tenantId=X&ownerId=Y&role=Z
   */
  getSignalSnapshots(filters?: SignalSnapshotFilters): Observable<SignalSnapshotResponse> {
    let params = new HttpParams().set('tenantId', environment.talentFlow.tenantId);
    if (filters?.ownerId) params = params.set('ownerId', filters.ownerId);
    if (filters?.role) params = params.set('role', filters.role);
    if (filters?.limit) params = params.set('limit', String(filters.limit));

    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<SignalSnapshotResponse>(
          `${this.baseUrl}/intelligence/snapshots`,
          { headers, params },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  /**
   * Fetch intelligence tiles (pre-generated from rules)
   * GET /v1/intelligence/tiles?tenantId=X&role=Y
   */
  getIntelligenceTiles(role?: 'TA' | 'HM' | 'IT'): Observable<IntelligenceTilesResponse> {
    let params = new HttpParams()
      .set('tenantId', environment.talentFlow.tenantId)
      .set('_t', Date.now().toString()); // Cache-busting timestamp
    if (role) params = params.set('role', role);

    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.get<IntelligenceTilesResponse>(
          `${this.baseUrl}/intelligence/tiles`,
          { headers, params },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  /**
   * Dismiss a tile (user has seen/actioned it)
   * POST /v1/intelligence/tiles/{id}/dismiss
   */
  dismissTile(tileId: string): Observable<void> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<void>(
          `${this.baseUrl}/intelligence/tiles/${tileId}/dismiss`,
          {},
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  /**
   * Snooze a tile (remind later)
   * POST /v1/intelligence/tiles/{id}/snooze
   */
  snoozeTile(tileId: string, hours: number): Observable<void> {
    return this.authHeaders().pipe(
      switchMap((headers) =>
        this.http.post<void>(
          `${this.baseUrl}/intelligence/tiles/${tileId}/snooze`,
          { hours },
          { headers },
        ),
      ),
      timeout(API_TIMEOUT_MS),
      catchError(this.handleError),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // State Management Methods (signal-based)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load tiles and update internal state
   * Called on dashboard init
   */
  loadTiles(role?: 'TA' | 'HM' | 'IT'): void {
    this._isLoading.set(true);
    this._error.set(null);

    this.getIntelligenceTiles(role).subscribe({
      next: (response) => {
        this._tiles.set(response.tiles);
        this._isLoading.set(false);
      },
      error: (err: { userMessage?: string }) => {
        this._error.set(err.userMessage ?? 'Failed to load intelligence tiles.');
        this._isLoading.set(false);
        // Fallback: try to generate tiles from snapshots
        this.loadTilesFromSnapshots(role);
      },
    });
  }

  /**
   * Fallback: Generate tiles client-side from signal snapshots
   * Used when tile API is not yet available
   */
  loadTilesFromSnapshots(role?: 'TA' | 'HM' | 'IT'): void {
    this.getSignalSnapshots({ role }).subscribe({
      next: (response) => {
        const tiles = this.generateTilesFromSnapshots(response.snapshots);
        this._tiles.set(tiles);
        this._isLoading.set(false);
      },
      error: () => {
        // Final fallback: use mock data for development
        this._tiles.set(this.getMockTiles());
        this._isLoading.set(false);
      },
    });
  }

  /**
   * Dismiss tile and update local state
   */
  handleDismiss(tileId: string): void {
    // Optimistic update
    this._tiles.update(tiles => tiles.filter(t => t.id !== tileId));

    this.dismissTile(tileId).subscribe({
      error: () => {
        // Revert on error (in production, would re-fetch)
        console.warn('[IntelligenceService] Dismiss failed - tile may reappear on refresh');
      },
    });
  }

  /**
   * Snooze tile and update local state
   */
  handleSnooze(tileId: string, hours: number): void {
    // Optimistic update
    this._tiles.update(tiles => tiles.filter(t => t.id !== tileId));

    this.snoozeTile(tileId, hours).subscribe({
      error: () => {
        console.warn('[IntelligenceService] Snooze failed - tile may reappear on refresh');
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tile Generation (client-side fallback)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate intelligence tiles from signal snapshots
   * Business rules for tile generation (matches Lambda rules)
   */
  private generateTilesFromSnapshots(snapshots: SignalSnapshot[]): IntelligenceTile[] {
    const tiles: IntelligenceTile[] = [];

    for (const snapshot of snapshots) {
      const signals = snapshot.signals;

      // Rule 1: SLA Breached
      if (signals['SLA_STATUS'] === 'BREACHED') {
        tiles.push(this.createTile(snapshot, {
          priority: 'CRITICAL',
          title: 'SLA Breached',
          description: `${snapshot.entityName} has breached SLA threshold`,
          ruleId: 'RULE-SLA-001',
        }));
      }

      // Rule 2: SLA At Risk
      else if (signals['SLA_STATUS'] === 'AT_RISK') {
        tiles.push(this.createTile(snapshot, {
          priority: 'HIGH',
          title: 'SLA At Risk',
          description: `${snapshot.entityName} is approaching SLA threshold`,
          ruleId: 'RULE-SLA-002',
        }));
      }

      // Rule 3: Offer Expiring Soon
      const daysToExpiry = signals['OFFER_DAYS_TO_EXPIRY'] as number | null;
      if (daysToExpiry !== null && daysToExpiry <= TILE_THRESHOLDS.OFFER_EXPIRY_URGENT && daysToExpiry >= 0) {
        tiles.push(this.createTile(snapshot, {
          priority: daysToExpiry <= 1 ? 'CRITICAL' : 'HIGH',
          title: 'Offer Expiring Soon',
          description: `Offer for ${snapshot.entityName} expires in ${daysToExpiry} day${daysToExpiry !== 1 ? 's' : ''}`,
          ruleId: 'RULE-OFFER-001',
        }));
      }

      // Rule 4: High Score Candidate Ready
      const finalScore = signals['FINAL_SCORE'] as number | null;
      if (finalScore !== null && finalScore >= TILE_THRESHOLDS.FINAL_SCORE_HIGH) {
        tiles.push(this.createTile(snapshot, {
          priority: 'MEDIUM',
          title: 'Strong Candidate Ready',
          description: `${snapshot.entityName} scored ${finalScore}% — ready for decision`,
          ruleId: 'RULE-HIPO-001',
        }));
      }

      // Rule 5: Engagement Falling
      const engagementSentiment = signals['ENGAGEMENT_SENTIMENT'] as string | null;
      if (engagementSentiment === 'HESITANT' || engagementSentiment === 'DISENGAGED') {
        tiles.push(this.createTile(snapshot, {
          priority: 'HIGH',
          title: 'Engagement Falling',
          description: `${snapshot.entityName} showing ${engagementSentiment?.toLowerCase()} signals`,
          ruleId: 'RULE-DROP-001',
        }));
      }
    }

    // Sort by priority (CRITICAL > HIGH > MEDIUM > LOW)
    const priorityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return tiles.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  /**
   * Create a tile from a snapshot and rule metadata
   */
  private createTile(
    snapshot: SignalSnapshot,
    opts: { priority: IntelligenceTile['priority']; title: string; description: string; ruleId: string },
  ): IntelligenceTile {
    return {
      id: `tile-${snapshot.entityId}-${opts.ruleId}`,
      priority: opts.priority,
      title: opts.title,
      description: opts.description,
      entityType: snapshot.entityType,
      entityId: snapshot.entityId,
      entityName: snapshot.entityName ?? 'Unknown',
      currentStage: snapshot.currentStage,
      signals: this.extractTileSignals(snapshot),
      actions: this.getDefaultActions(snapshot),
      createdAt: snapshot.computedAt,
      ruleId: opts.ruleId,
    };
  }

  /**
   * Extract displayable signals for tile
   */
  private extractTileSignals(snapshot: SignalSnapshot): IntelligenceTile['signals'] {
    const signals: IntelligenceTile['signals'] = [];
    const s = snapshot.signals;

    if (snapshot.currentStage) {
      signals.push({
        label: 'Stage',
        value: STAGE_LABELS[snapshot.currentStage] ?? snapshot.currentStage,
        type: 'info',
      });
    }

    if (s['SLA_STATUS']) {
      signals.push({
        label: 'SLA',
        value: s['SLA_STATUS'] as string,
        type: s['SLA_STATUS'] === 'BREACHED' ? 'error' : s['SLA_STATUS'] === 'AT_RISK' ? 'warning' : 'success',
      });
    }

    if (s['FINAL_SCORE'] !== null && s['FINAL_SCORE'] !== undefined) {
      const score = s['FINAL_SCORE'] as number;
      signals.push({
        label: 'Score',
        value: `${score}%`,
        type: score >= 85 ? 'success' : score >= 60 ? 'info' : 'warning',
      });
    }

    return signals;
  }

  /**
   * Get default actions for a tile
   */
  private getDefaultActions(snapshot: SignalSnapshot): IntelligenceTile['actions'] {
    const actions: IntelligenceTile['actions'] = [
      {
        id: 'view',
        label: 'View',
        icon: 'pi pi-eye',
        type: 'primary',
        route: `/platform/talentflow/candidates/${snapshot.entityId}`,
      },
    ];

    return actions;
  }

  /**
   * Mock tiles for development/testing
   */
  private getMockTiles(): IntelligenceTile[] {
    return [
      {
        id: 'mock-tile-1',
        priority: 'CRITICAL',
        title: 'SLA Breached',
        description: 'Sabelo Hadebe has breached SLA threshold',
        entityType: 'CANDIDATE',
        entityId: 'CAND-01KT3Y068RZVX3HHG1CA3PG87T',
        entityName: 'Sabelo Hadebe',
        currentStage: 'PRE_BOARDING',
        signals: [
          { label: 'Stage', value: 'Pre-Boarding', type: 'info' },
          { label: 'SLA', value: 'BREACHED', type: 'error' },
          { label: 'Score', value: '5%', type: 'warning' },
        ],
        actions: [
          {
            id: 'view',
            label: 'View Candidate',
            icon: 'pi pi-eye',
            type: 'primary',
            route: '/platform/talentflow/candidates/CAND-01KT3Y068RZVX3HHG1CA3PG87T',
          },
        ],
        createdAt: new Date().toISOString(),
        ruleId: 'RULE-SLA-001',
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Handling
  // ═══════════════════════════════════════════════════════════════════════════

  private handleError(error: unknown): Observable<never> {
    const err = error as { status?: number; message?: string; name?: string };
    let userMessage = 'An unexpected error occurred. Please try again.';

    if (err.name === 'TimeoutError') {
      userMessage = 'Request timed out. Please check your connection and try again.';
    } else if (err.status === 401) {
      userMessage = 'Your session has expired. Please sign in again.';
    } else if (err.status === 403) {
      userMessage = 'You do not have permission to perform this action.';
    } else if (err.status === 404) {
      userMessage = 'The requested resource was not found.';
    } else if (err.status && err.status >= 500) {
      userMessage = 'A server error occurred. Please try again later.';
    }

    return throwError(() => ({ ...err, userMessage }));
  }
}
