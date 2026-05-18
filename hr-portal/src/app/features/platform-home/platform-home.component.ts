import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { AuthService } from '../../core/services/auth.service';

interface ModuleTile {
  key: string;
  label: string;
  icon: string;
  description: string;
  route: string;
  available: boolean;
  comingSoon?: boolean;
}

@Component({
  selector: 'app-platform-home',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, TagModule, TopbarComponent, FooterComponent],
  templateUrl: './platform-home.component.html',
  styleUrl: './platform-home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformHomeComponent {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.auth.currentUser()?.givenName || 'there';
    if (hour < 12) return `Good morning, ${name}`;
    if (hour < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  });

  readonly tiles = computed<ModuleTile[]>(() => {
    const modules = this.auth.currentUser()?.modules ?? [];
    return [
      {
        key: 'onboarding',
        label: 'Onboarding',
        icon: 'pi pi-users',
        description: 'Candidate pipeline, document verification, and risk classification.',
        route: '/platform/onboarding',
        available: modules.includes('onboarding'),
      },
      {
        key: 'talentflow',
        label: 'TalentFlow',
        icon: 'pi pi-briefcase',
        description: 'Requisitions, talent pipeline, interviews, and offers.',
        route: '/platform/talentflow',
        available: modules.includes('talentflow'),
      },
      {
        key: 'it-requests',
        label: 'IT Requests',
        icon: 'pi pi-desktop',
        description: 'Automate IT provisioning for new hires.',
        route: '/platform/it-requests',
        available: false,
        comingSoon: true,
      },
      {
        key: 'employee-360',
        label: 'Employee 360',
        icon: 'pi pi-id-card',
        description: 'Full employee profile across all HR touchpoints.',
        route: '/platform/employee-360',
        available: false,
        comingSoon: true,
      },
    ];
  });

  openModule(tile: ModuleTile): void {
    if (tile.available) {
      this.router.navigate([tile.route]);
    }
  }
}
