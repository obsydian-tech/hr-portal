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
    :host { display: block; padding: 1.5rem 2rem; max-width: 960px; margin: 0 auto; }
    .ip-completed__header h1 { font-size: 1.375rem; font-weight: 700; margin: 0 0 0.25rem; }
    .ip-completed__header p  { font-size: 0.875rem; color: #64748b; margin: 0 0 1.5rem; }
    .ip-completed__empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 3rem; color: #64748b; }
    .ip-completed__list  { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; }
    .ip-completed__item  { display: flex; gap: 1rem; align-items: center; padding: 1rem 1.25rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
    .ip-completed__type  { font-weight: 700; font-size: 0.8125rem; text-transform: uppercase; color: #1e293b; }
    .ip-completed__name  { font-size: 0.9375rem; font-weight: 600; color: #1e293b; }
    .ip-completed__role  { font-size: 0.875rem; color: #64748b; }
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
