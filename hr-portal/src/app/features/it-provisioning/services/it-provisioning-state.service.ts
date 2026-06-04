import { Injectable, signal, computed } from '@angular/core';
import { ItTask } from '../models/it-provisioning.models';

@Injectable({ providedIn: 'root' })
export class ItProvisioningStateService {
  readonly tasks = signal<ItTask[]>([]);

  readonly slaBreachCount = computed(() =>
    this.tasks().filter(t => t.slaStatus === 'BREACHED').length,
  );

  readonly breachedTasks = computed(() =>
    this.tasks().filter(t => t.slaStatus === 'BREACHED'),
  );
}
