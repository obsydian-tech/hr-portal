import { Injectable } from '@angular/core';
import { ItTask, ItQueue, RequirementType } from '../models/it-provisioning.models';

/**
 * ItProvisioningApiService
 *
 * Mocked API service for IT Provisioning tasks.
 * Replace HTTP calls with real REST calls once IT Provisioning API is deployed.
 * All methods return Promises to mirror production API shape.
 */
@Injectable({ providedIn: 'root' })
export class ItProvisioningApiService {

  /** Returns all tasks assigned to (or claimable by) the current specialist. */
  async getMyTasks(specialistId: string): Promise<ItTask[]> {
    return Promise.resolve(MOCK_TASKS);
  }

  async getCompletedTasks(specialistId: string): Promise<ItTask[]> {
    return Promise.resolve(MOCK_COMPLETED);
  }

  async claimTask(taskId: string, specialistId: string): Promise<void> {
    const task = MOCK_TASKS.find(t => t.id === taskId);
    if (task) {
      task.taskStatus = 'CLAIMED';
      task.claimedBy  = specialistId;
    }
    return Promise.resolve();
  }

  async completeTask(taskId: string): Promise<void> {
    const idx = MOCK_TASKS.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const [done] = MOCK_TASKS.splice(idx, 1);
      done.taskStatus = 'COMPLETED';
      MOCK_COMPLETED.unshift(done);
    }
    return Promise.resolve();
  }

  /** Returns the queues available to a specialist (based on assignedQueues). */
  getQueues(assignedQueues: string[]): ItQueue[] {
    const all = MOCK_TASKS.filter(t => assignedQueues.includes(t.queue));
    const map = new Map<RequirementType, number>();
    for (const t of all) {
      map.set(t.queue, (map.get(t.queue) ?? 0) + 1);
    }
    return assignedQueues.map(q => ({
      type: q as RequirementType,
      count: map.get(q as RequirementType) ?? 0,
    }));
  }
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_TASKS: ItTask[] = [
  {
    id: 'task-001',
    requirementType: 'Hardware',
    newHire: { name: 'Naledi Dlamini', role: 'Data Engineer', startDate: '2025-06-02', daysRemaining: 5 },
    slaStatus: 'BREACHED',
    taskStatus: 'UNASSIGNED',
    claimedBy: null,
    hmNote: 'Naledi needs a laptop with additional RAM — she\'ll be running heavy data pipelines from day one.',
    slaProgress: 105,
    queue: 'Hardware',
  },
  {
    id: 'task-002',
    requirementType: 'Access & Identity',
    newHire: { name: 'Thabo Sithole', role: 'Senior Developer', startDate: '2025-06-05', daysRemaining: 8 },
    slaStatus: 'AT_RISK',
    taskStatus: 'UNASSIGNED',
    claimedBy: null,
    hmNote: null,
    slaProgress: 80,
    queue: 'Access & Identity',
  },
  {
    id: 'task-003',
    requirementType: 'Software',
    newHire: { name: 'Yemi Adeyemi', role: 'UX Designer', startDate: '2025-06-10', daysRemaining: 13 },
    slaStatus: 'AT_RISK',
    taskStatus: 'CLAIMED',
    claimedBy: 'specialist-001',
    hmNote: 'Needs Figma Professional and Adobe CC — please have both licensed by start date.',
    slaProgress: 72,
    queue: 'Software',
  },
  {
    id: 'task-004',
    requirementType: 'Facilities',
    newHire: { name: 'Keabetswe Mokoena', role: 'HR Business Partner', startDate: '2025-06-20', daysRemaining: 23 },
    slaStatus: 'ON_TRACK',
    taskStatus: 'UNASSIGNED',
    claimedBy: null,
    hmNote: null,
    slaProgress: 35,
    queue: 'Facilities',
  },
  {
    id: 'task-005',
    requirementType: 'Hardware',
    newHire: { name: 'Sipho Ndlovu', role: 'Finance Analyst', startDate: '2025-06-25', daysRemaining: 28 },
    slaStatus: 'ON_TRACK',
    taskStatus: 'UNASSIGNED',
    claimedBy: null,
    hmNote: null,
    slaProgress: 20,
    queue: 'Hardware',
  },
  {
    id: 'task-006',
    requirementType: 'Access & Identity',
    newHire: { name: 'Amara Osei', role: 'Product Manager', startDate: '2025-07-01', daysRemaining: 34 },
    slaStatus: 'ON_TRACK',
    taskStatus: 'CLAIMED',
    claimedBy: 'specialist-001',
    hmNote: null,
    slaProgress: 15,
    queue: 'Access & Identity',
  },
];

const MOCK_COMPLETED: ItTask[] = [
  {
    id: 'task-100',
    requirementType: 'Hardware',
    newHire: { name: 'Lungisa Mthembu', role: 'Cloud Engineer', startDate: '2025-05-15', daysRemaining: 0 },
    slaStatus: 'ON_TRACK',
    taskStatus: 'COMPLETED',
    claimedBy: 'specialist-001',
    hmNote: null,
    slaProgress: 100,
    queue: 'Hardware',
  },
];
