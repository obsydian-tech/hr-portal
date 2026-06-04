import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

interface ModuleStat {
  label: string;
  value: string;
}

interface ModuleShortcut {
  label: string;
  icon: string;
  route: string;
}

interface ModuleTile {
  key: string;
  label: string;
  icon: string;
  description: string;
  route: string;
  available: boolean;
  comingSoon?: boolean;
  featured?: boolean;
  color?: 'indigo' | 'teal' | 'amber' | 'navy' | 'muted';
  telemetry?: string;
  stats?: ModuleStat[];
  shortcuts?: ModuleShortcut[];
}

interface ChatMessage {
  id: number;
  role: 'system' | 'manager' | 'agent';
  text: string;
}

@Component({
  selector: 'app-platform-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-home.component.html',
  styleUrl: './platform-home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformHomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  // ── Chat console ──────────────────────────────────────────────────────────
  readonly chatMessages = signal<ChatMessage[]>([]);
  readonly showTyping   = signal(false);
  readonly chatFading   = signal(false);
  private chatTimeouts: ReturnType<typeof setTimeout>[] = [];

  ngOnInit() {
    this.startChatSequence();
  }

  ngOnDestroy() {
    this.clearChatTimers();
  }

  private clearChatTimers(): void {
    this.chatTimeouts.forEach(t => clearTimeout(t));
    this.chatTimeouts = [];
  }

  private schedule(delay: number, fn: () => void): void {
    this.chatTimeouts.push(setTimeout(fn, delay));
  }

  private startChatSequence(): void {
    this.clearChatTimers();
    this.chatMessages.set([]);
    this.showTyping.set(false);
    this.chatFading.set(false);

    this.schedule(400, () => this.chatMessages.update(m => [...m, {
      id: 1, role: 'system',
      text: 'Initiating background compliance sweep across active modules...',
    }]));

    this.schedule(2200, () => this.chatMessages.update(m => [...m, {
      id: 2, role: 'manager',
      text: '@TalentFlow-Agent — check pending offers for the Cape Town engineering hub. Any candidates missing document verification?',
    }]));

    this.schedule(3800, () => this.showTyping.set(true));

    this.schedule(6800, () => {
      this.showTyping.set(false);
      this.chatMessages.update(m => [...m, {
        id: 3, role: 'agent',
        text: 'Compliance check complete. 2 candidates flagged: NDA and ID verification outstanding. Automated WhatsApp notifications dispatched. SLA timer paused pending response. Tracking telemetry updated in real time.',
      }]);
    });

    this.schedule(8400, () => this.chatMessages.update(m => [...m, {
      id: 4, role: 'system',
      text: 'Offer pipeline: 3 approvals pending sign-off. 1 offer overdue > 48h — escalation protocol triggered.',
    }]));

    this.schedule(10000, () => this.showTyping.set(true));

    this.schedule(13200, () => {
      this.showTyping.set(false);
      this.chatMessages.update(m => [...m, {
        id: 5, role: 'agent',
        text: 'Escalation complete. Hiring manager and HR Director notified via priority channel. Calendar block requested: 14:00 urgent review. All actions committed to audit trail — ref #ESC-0042.',
      }]);
    });

    this.schedule(20000, () => this.chatFading.set(true));
    this.schedule(21500, () => this.startChatSequence());
  }

  roleLabel(role: 'system' | 'manager' | 'agent'): string {
    const map = { system: 'SYSTEM', manager: 'MANAGER', agent: 'AGENT' };
    return map[role];
  }

  // ── Greeting ──────────────────────────────────────────────────────────────
  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.auth.currentUser()?.givenName || 'there';
    if (hour < 12) return `Good morning, ${name}`;
    if (hour < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  });

  // ── Module tiles ──────────────────────────────────────────────────────────
  readonly tiles = computed<ModuleTile[]>(() => {
    const modules = this.auth.currentUser()?.modules ?? [];
    const isAdmin = this.auth.currentUser()?.groups?.includes('naleko-talentflow-admin') ?? false;

    return [
      {
        key: 'talentflow',
        label: 'TalentFlow',
        icon: 'pi pi-briefcase',
        description: 'Requisitions, talent pipeline, interviews, and offers.',
        route: '/platform/talentflow',
        available: modules.includes('talentflow'),
        featured: true,
        color: 'indigo',
        telemetry: 'Pipeline Active',
        stats: [
          { label: 'Active Candidates', value: '22' },
          { label: 'SLA Breaches',      value: '6'  },
          { label: 'Offers Pending',    value: '3'  },
        ],
      },
      ...(isAdmin
        ? [{
            key: 'platform-admin',
            label: 'Platform Administration',
            icon: 'pi pi-sliders-h',
            description: 'Manage users, roles, and platform-wide settings.',
            route: '/platform/talentflow/admin/overview',
            available: true,
            color: 'navy' as const,
            shortcuts: [
              { label: 'Users',         icon: 'pi pi-users', route: '/platform/talentflow/admin/users'                         },
              { label: 'Config',        icon: 'pi pi-cog',   route: '/platform/talentflow/admin/talentflow-config/stage-config' },
              { label: 'Notifications', icon: 'pi pi-bell',  route: '/platform/talentflow/admin/notifications'                 },
              { label: 'Audit',         icon: 'pi pi-list',  route: '/platform/talentflow/admin/audit'                         },
            ],
          }]
        : []),
      {
        key: 'onboarding',
        label: 'Onboarding',
        icon: 'pi pi-users',
        description: 'Candidate pipeline, document verification, and risk classification.',
        route: '/platform/onboarding',
        available: modules.includes('onboarding'),
        color: 'teal',
      },
      {
        key: 'it-requests',
        label: 'IT Requests',
        icon: 'pi pi-desktop',
        description: 'Automate IT provisioning for new hires.',
        route: '/platform/it-requests',
        available: modules.includes('it-provisioning'),
        color: 'amber',
        telemetry: '3 requests pending',
        stats: [
          { label: 'Pending',    value: '3'  },
          { label: 'This Month', value: '12' },
          { label: 'Avg. Days',  value: '2'  },
        ],
      },
      {
        key: 'employee-360',
        label: 'Employee 360',
        icon: 'pi pi-id-card',
        description: 'Full employee profile across all HR touchpoints.',
        route: '/platform/employee-360',
        available: false,
        comingSoon: true,
        color: 'muted',
      },
    ];
  });

  openModule(tile: ModuleTile): void {
    if (tile.available) {
      this.router.navigate([tile.route]);
    }
  }

  openShortcut(sc: ModuleShortcut): void {
    this.router.navigate([sc.route]);
  }
}
