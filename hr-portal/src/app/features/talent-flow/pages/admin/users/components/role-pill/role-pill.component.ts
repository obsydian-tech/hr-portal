import {
  Component,
  ChangeDetectionStrategy,
  input,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { TalentFlowRole, ROLE_LABELS } from '../../../../../models/admin.models';

/**
 * RolePillComponent — admin-S1 MUST 4
 *
 * Array-aware, reusable role pill strip.
 * Accepts the full roles[] array and the activeRole for highlighting.
 * Each pill is colour-coded by role; the active role receives a ring.
 *
 * Usage:
 *   <tf-role-pill [roles]="user.roles" [activeRole]="user.activeRole" />
 */
@Component({
  selector: 'tf-role-pill',
  standalone: true,
  imports: [NgClass],
  templateUrl: './role-pill.component.html',
  styleUrl: './role-pill.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolePillComponent {
  /** All roles assigned to the user. */
  readonly roles = input<TalentFlowRole[]>([]);

  /**
   * The currently active (highest-precedence) role.
   * Receives a distinct ring highlight when set.
   */
  readonly activeRole = input<TalentFlowRole | null>(null);

  protected readonly roleLabels = ROLE_LABELS;

  protected pillClasses(role: TalentFlowRole): Record<string, boolean> {
    return {
      'tf-role-pill': true,
      [`tf-role-pill--${role.toLowerCase()}`]: true,
      'tf-role-pill--active': role === this.activeRole(),
    };
  }
}
