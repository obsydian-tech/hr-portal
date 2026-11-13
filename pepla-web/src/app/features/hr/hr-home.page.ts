import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PpPageHeader } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';

/** HR home. ONB-01 ships the page shell and its greeting; ONB-02 puts the HR list of new employees on it. */
@Component({
  selector: 'app-hr-home',
  imports: [PpPageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pp-page-header [heading]="'Welcome back, ' + firstName()" />`,
})
export class HrHomePage {
  private readonly auth = inject(AuthService);
  protected readonly firstName = () => this.auth.user()?.givenName ?? '';
}
