import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { DatePipe } from '@angular/common';

/**
 * ConfigVersionBadge — displays the version, changed-by, and changed-at for an
 * admin-managed config record.
 *
 * Usage:
 *   <tf-config-version-badge [version]="3" [changedBy]="'admin@example.com'" [changedAt]="'2026-05-15T10:00:00Z'" />
 */
@Component({
  selector: 'tf-config-version-badge',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './config-version-badge.component.html',
  styleUrl: './config-version-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigVersionBadgeComponent {
  readonly version   = input<string | null>(null);
  readonly changedBy = input<string | null>(null);
  readonly changedAt = input<string | null>(null);

  protected readonly hasData = computed(() => this.version() != null);
}
