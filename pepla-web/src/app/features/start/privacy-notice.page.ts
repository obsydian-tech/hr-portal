import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PpButton, PpCard, PpLink, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup } from '../../ds';
import { RouterLink } from '@angular/router';
import { StartService } from '../../core/start/start.service';

const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";

/**
 * The full privacy notice (ONB-05), in the words the server sends for the current version.
 * Opened straight from its address, it asks for the same GET /v1/me as Today.
 */
@Component({
  selector: 'app-privacy-notice',
  imports: [RouterLink, PpButton, PpCard, PpLink, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header heading="Privacy notice" [description]="version()" />

      @switch (service.state().kind) {
        @case ('loading') {
          <pp-skeleton-group label="Loading the privacy notice" class="pp-stack pp-gap-200">
            <pp-skeleton shape="text" width="60%" />
            <pp-skeleton shape="card" />
          </pp-skeleton-group>
        }
        @case ('refused') {
          <pp-section-message tone="danger">{{ refusal() }}</pp-section-message>
        }
        @case ('offline') {
          <pp-section-message tone="danger">{{ offline }}
            <pp-section-message-actions><button ppButton type="button" (click)="reload()">Try again</button></pp-section-message-actions>
          </pp-section-message>
        }
        @case ('ready') {
          @if (notice(); as n) {
            @for (s of n.full; track s.heading) {
              <pp-card [heading]="s.heading" [level]="2">
                <p class="pp-text">{{ s.text }}</p>
              </pp-card>
            }
          }
        }
      }

      <a ppLink routerLink="/start">Back to Today</a>
    </div>
  `,
})
export class PrivacyNoticePage {
  protected readonly service = inject(StartService);
  protected readonly offline = OFFLINE;

  protected readonly notice = computed(() => {
    const s = this.service.state();
    return s.kind === 'ready' ? s.me.notice : null;
  });
  protected readonly version = computed(() => {
    const n = this.notice();
    return n ? `Version ${n.version}` : undefined;
  });
  protected readonly refusal = computed(() => {
    const s = this.service.state();
    return s.kind === 'refused' ? s.message : '';
  });

  constructor() {
    void this.service.load();
  }

  protected reload(): void {
    void this.service.load(true);
  }
}
