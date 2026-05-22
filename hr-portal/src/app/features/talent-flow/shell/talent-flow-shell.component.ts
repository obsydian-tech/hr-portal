import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { AvatarModule } from 'primeng/avatar';
import { DrawerModule } from 'primeng/drawer';
import { TalentFlowAuthService } from '../services/talent-flow-auth.service';
import { TalentFlowStateService } from '../services/talent-flow-state.service';
import { ConnectivityService } from '../services/connectivity.service';
import { AiChatPanelComponent } from '../components/ai-chat-panel/ai-chat-panel.component';
import { CandidateCreatePageComponent } from '../pages/candidate-create/candidate-create-page.component';

const ROLE_LABELS: Record<string, string> = {
  TalentFlowAdmin: 'Admin',
  HiringManager:   'Hiring Manager',
  PanelMember:     'Panel Member',
  ComplianceOfficer: 'Compliance',
  HRDirector:      'HR Director',
};

@Component({
  selector: 'tf-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ButtonModule,
    BadgeModule,
    AvatarModule,
    DrawerModule,
    AiChatPanelComponent,
    CandidateCreatePageComponent,
  ],
  templateUrl: './talent-flow-shell.component.html',
  styleUrl: './talent-flow-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TalentFlowShellComponent {
  private readonly router         = inject(Router);
  protected readonly tfAuth       = inject(TalentFlowAuthService);
  protected readonly state        = inject(TalentFlowStateService);
  protected readonly connectivity = inject(ConnectivityService);

  protected readonly addCandidateOpen = signal(false);
  protected readonly aiChatOpen       = signal(false);

  protected readonly rolePill = computed<string>(() => {
    const user = this.tfAuth.currentUser();
    if (!user) return '';
    for (const group of user.groups) {
      if (ROLE_LABELS[group]) return ROLE_LABELS[group];
    }
    return 'TA Specialist';
  });

  protected readonly initials = computed<string>(() => {
    const user = this.tfAuth.currentUser();
    if (!user) return '?';
    return ((user.givenName[0] ?? '') + (user.familyName[0] ?? '')).toUpperCase();
  });

  protected readonly bellBadge = computed<string | undefined>(() => {
    const count = this.state.slaBreachCount();
    return count > 0 ? count.toString() : undefined;
  });

  protected openAiChat(): void {
    this.aiChatOpen.set(true);
  }

  protected onCandidateCreated(candidateId: string): void {
    this.addCandidateOpen.set(false);
    void this.router.navigate(['/platform/talentflow/candidates', candidateId]);
  }

  protected onLogout(): void {
    this.tfAuth.logout();
    void this.router.navigate(['/platform/home']);
  }
}
