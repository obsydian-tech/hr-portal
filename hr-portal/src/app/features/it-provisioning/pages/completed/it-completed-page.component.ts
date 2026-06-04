import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { ItTask } from '../../models/it-provisioning.models';
import { ItProvisioningApiService } from '../../services/it-provisioning-api.service';
import { TalentFlowAuthService } from '../../../talent-flow/services/talent-flow-auth.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'ip-completed-page',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ip-completed">
      <div class="ip-completed__header">
        <h1>Completed Tasks</h1>
        <p>Tasks you have resolved.</p>
      </div>

      @if (loading()) {
        <p class="ip-completed__loading">Loading…</p>
      } @else if (tasks().length === 0) {
        <div class="ip-completed__empty">
          <i class="pi pi-inbox"></i>
          <p>No completed tasks yet.</p>
        </div>
      } @else {
        <ul class="ip-completed__list">
          @for (task of tasks(); track task.id) {
            <li class="ip-completed__item">
              <span class="ip-completed__type">{{ task.requirementType }}</span>
              <span class="ip-completed__name">{{ task.newHire.name }}</span>
              <span class="ip-completed__role">{{ task.newHire.role }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      padding: 2rem 2rem 4rem;
      max-width: 960px;
      margin: 0 auto;
    }

    .ip-completed__header {
      margin-bottom: 1.75rem;
    }

    .ip-completed__header h1 {
      font-family: var(--naleko-font-display);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--naleko-on-surface);
      margin: 0 0 0.25rem;
      letter-spacing: -0.01em;
    }

    .ip-completed__header p {
      font-size: 0.875rem;
      color: var(--naleko-on-surface-variant);
      margin: 0;
    }

    .ip-completed__loading {
      text-align: center;
      color: var(--naleko-on-surface-variant);
      padding: 3rem;
    }

    .ip-completed__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 3rem;
      color: var(--naleko-on-surface-variant);
      font-size: 0.9375rem;
    }

    .ip-completed__empty i { font-size: 2rem; }
    .ip-completed__empty p { margin: 0; }

    .ip-completed__list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .ip-completed__item {
      display: flex;
      gap: 1rem;
      align-items: center;
      padding: 1rem 1.25rem;
      background: var(--naleko-surface-container-lowest);
      border: 1.5px solid rgba(200, 197, 205, 0.2);
      border-radius: var(--naleko-radius-xl);
      box-shadow: var(--naleko-shadow-card);
      transition: box-shadow var(--naleko-duration) var(--naleko-ease),
                  border-color var(--naleko-duration) var(--naleko-ease);
    }

    .ip-completed__item:hover {
      box-shadow: var(--naleko-shadow-lg);
      border-color: color-mix(in srgb, var(--naleko-success) 30%, transparent);
    }

    .ip-completed__type {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.2rem 0.6rem;
      border-radius: var(--naleko-radius-pill);
      background: color-mix(in srgb, var(--naleko-success) 12%, transparent);
      color: var(--naleko-success);
      white-space: nowrap;
    }

    .ip-completed__name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--naleko-on-surface);
      flex: 1;
    }

    .ip-completed__role {
      font-size: 0.875rem;
      color: var(--naleko-on-surface-variant);
    }
  `],
})
export class ItCompletedPageComponent implements OnInit {
  private readonly api        = inject(ItProvisioningApiService);
  private readonly tfAuth     = inject(TalentFlowAuthService);
  private readonly nalekoAuth = inject(AuthService);

  protected readonly loading = signal(true);
  protected readonly tasks   = signal<ItTask[]>([]);

  private get specialistId(): string {
    return this.tfAuth.currentUser()?.sub ?? this.nalekoAuth.currentUser()?.staffId ?? '';
  }

  async ngOnInit(): Promise<void> {
    const list = await this.api.getCompletedTasks();
    this.tasks.set(list);
    this.loading.set(false);
  }
}
