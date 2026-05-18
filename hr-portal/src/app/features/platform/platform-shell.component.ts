import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * PlatformShellComponent — Epic 5
 *
 * Bare router-outlet wrapper for all /platform/* children.
 * Each child module (platform-home, talentflow) provides its own nav/header.
 * authGuard is applied at the /platform route level in app.routes.ts.
 */
@Component({
  selector: 'app-platform-shell',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class PlatformShellComponent {}
