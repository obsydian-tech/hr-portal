import { Injectable } from '@angular/core';
import { ItTask, ItQueue, RequirementType, FulfilmentData } from '../models/it-provisioning.models';

/**
 * ItProvisioningApiService — mocked, replace with real HTTP calls when API is live.
 */
@Injectable({ providedIn: 'root' })
export class ItProvisioningApiService {

  async getMyTasks(specialistId: string): Promise<ItTask[]> {
    return Promise.resolve(MOCK_TASKS);
  }

  async getCompletedTasks(specialistId: string): Promise<ItTask[]> {
    return Promise.resolve(MOCK_COMPLETED);
  }

  async getTaskById(taskId: string): Promise<ItTask | null> {
    return Promise.resolve(
      MOCK_TASKS.find(t => t.id === taskId) ??
      MOCK_COMPLETED.find(t => t.id === taskId) ??
      null
    );
  }

  async claimTask(taskId: string, specialistId: string, specialistName: string, specialistRole: string): Promise<void> {
    const task = MOCK_TASKS.find(t => t.id === taskId);
    if (task) {
      task.taskStatus    = 'CLAIMED';
      task.claimedBy     = specialistId;
      task.claimedByName = specialistName;
      task.claimedByRole = specialistRole;
      task.claimedAt     = 'Just now';
      task.activity.unshift({ type: 'claim', text: `Claimed by ${specialistName}`, timestamp: 'Just now', subtext: task.queue + ' queue' });
    }
    return Promise.resolve();
  }

  async releaseTask(taskId: string, reason: string): Promise<void> {
    const task = MOCK_TASKS.find(t => t.id === taskId);
    if (task) {
      task.taskStatus    = 'UNASSIGNED';
      task.claimedBy     = null;
      task.claimedByName = null;
      task.claimedByRole = null;
      task.claimedAt     = null;
      task.activity.unshift({ type: 'release', text: 'Released back to queue', timestamp: 'Just now', subtext: reason });
    }
    return Promise.resolve();
  }

  async completeTaskWithFulfilment(taskId: string, data: FulfilmentData): Promise<void> {
    const idx = MOCK_TASKS.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const [done] = MOCK_TASKS.splice(idx, 1);
      done.taskStatus = 'COMPLETED';
      done.activity.unshift({ type: 'complete', text: 'Marked complete', timestamp: 'Just now', subtext: `Asset: ${data.assetReference} · ${data.fulfilmentMethod}` });
      MOCK_COMPLETED.unshift(done);
    }
    return Promise.resolve();
  }

  getQueues(assignedQueues: string[]): ItQueue[] {
    const all = MOCK_TASKS.filter(t => assignedQueues.includes(t.queue));
    const map = new Map<RequirementType, number>();
    for (const t of all) { map.set(t.queue, (map.get(t.queue) ?? 0) + 1); }
    return assignedQueues.map(q => ({ type: q as RequirementType, count: map.get(q as RequirementType) ?? 0 }));
  }
}

// ─── Mock data ────────────────────────────────────────────────

const MOCK_TASKS: ItTask[] = [
  {
    id: 'task-001',
    title: 'Laptop — Mid Analyst spec',
    requirementType: 'Hardware',
    queue: 'Hardware',
    newHire: {
      name: 'Priya Naidoo',
      role: 'Data Analyst',
      seniority: 'Mid level',
      department: 'Analytics Team',
      startDate: '2 Jun 2026',
      daysRemaining: 10,
      deliveryLocation: 'Floor 3 · Analytics Team area · Cape Town office',
    },
    slaStatus: 'AT_RISK',
    taskStatus: 'CLAIMED',
    requiredBy: '2 Jun 2026',
    slaProgress: 72,
    claimedBy: 'specialist-001',
    claimedByName: 'Tom Mokoena',
    claimedByRole: 'Hardware specialist',
    claimedAt: '2 hours ago',
    hmNote: 'Standard Mid analyst build — M2, 16GB RAM, 512GB SSD is fine. No special requirements. Please configure with company standard image and ensure data analytics tools are pre-installed.',
    hmName: 'Marcus Khumalo',
    hmRole: 'Hiring Manager',
    bundleApprovedBy: 'Marcus Khumalo',
    checklist: [
      { id: 'c1', label: 'Hardware sourced and confirmed available', completed: true },
      { id: 'c2', label: 'Company standard image applied', completed: true },
      { id: 'c3', label: 'Asset tag recorded and logged in inventory system', completed: false },
      { id: 'c4', label: 'Delivery confirmed to correct location', completed: false },
    ],
    activity: [
      { type: 'claim',  text: 'Claimed by Tom Mokoena', timestamp: '2 hours ago', subtext: 'Hardware queue' },
      { type: 'sla',   text: 'SLA at risk — task unassigned approaching threshold', timestamp: 'Yesterday', subtext: 'Auto-flagged' },
      { type: 'create', text: 'Task created from approved bundle — Marcus Khumalo', timestamp: '5 days ago', subtext: 'Auto-routed to Hardware queue' },
    ],
  },
  {
    id: 'task-002',
    title: 'Access setup — Senior Developer',
    requirementType: 'Access & Identity',
    queue: 'Access & Identity',
    newHire: {
      name: 'Thabo Sithole',
      role: 'Senior Developer',
      seniority: 'Senior',
      department: 'Engineering',
      startDate: '5 Jun 2026',
      daysRemaining: 8,
      deliveryLocation: 'Floor 2 · Engineering Hub · Cape Town office',
    },
    slaStatus: 'AT_RISK',
    taskStatus: 'UNASSIGNED',
    requiredBy: '5 Jun 2026',
    slaProgress: 80,
    claimedBy: null, claimedByName: null, claimedByRole: null, claimedAt: null,
    hmNote: null, hmName: null, hmRole: null,
    bundleApprovedBy: 'Lindiwe Khumalo',
    checklist: [
      { id: 'c1', label: 'Active Directory account created', completed: false },
      { id: 'c2', label: 'Email account provisioned', completed: false },
      { id: 'c3', label: 'VPN access configured', completed: false },
      { id: 'c4', label: 'Dev system access confirmed', completed: false },
    ],
    activity: [
      { type: 'sla',    text: 'SLA at risk — task unassigned approaching threshold', timestamp: 'Today', subtext: 'Auto-flagged' },
      { type: 'create', text: 'Task created from approved bundle — Lindiwe Khumalo', timestamp: '3 days ago', subtext: 'Auto-routed to Access & Identity queue' },
    ],
  },
  {
    id: 'task-003',
    title: 'Software licences — UX Designer',
    requirementType: 'Software',
    queue: 'Software',
    newHire: {
      name: 'Yemi Adeyemi',
      role: 'UX Designer',
      seniority: 'Mid level',
      department: 'Product Design',
      startDate: '10 Jun 2026',
      daysRemaining: 13,
      deliveryLocation: 'Floor 1 · Design Studio · Cape Town office',
    },
    slaStatus: 'AT_RISK',
    taskStatus: 'CLAIMED',
    requiredBy: '10 Jun 2026',
    slaProgress: 72,
    claimedBy: 'specialist-001',
    claimedByName: 'Tom Mokoena',
    claimedByRole: 'Software specialist',
    claimedAt: 'Yesterday',
    hmNote: 'Needs Figma Professional and Adobe CC — please have both licensed by start date.',
    hmName: 'Zanele Dlamini',
    hmRole: 'Hiring Manager',
    bundleApprovedBy: 'Zanele Dlamini',
    checklist: [
      { id: 'c1', label: 'Figma Professional licence assigned', completed: false },
      { id: 'c2', label: 'Adobe CC licence provisioned', completed: false },
      { id: 'c3', label: 'Licence assignment confirmed in system', completed: false },
    ],
    activity: [
      { type: 'claim',  text: 'Claimed by Tom Mokoena', timestamp: 'Yesterday', subtext: 'Software queue' },
      { type: 'create', text: 'Task created from approved bundle — Zanele Dlamini', timestamp: '4 days ago', subtext: 'Auto-routed to Software queue' },
    ],
  },
  {
    id: 'task-004',
    title: 'Workstation setup — HR Business Partner',
    requirementType: 'Facilities',
    queue: 'Facilities',
    newHire: {
      name: 'Keabetswe Mokoena',
      role: 'HR Business Partner',
      seniority: 'Mid level',
      department: 'Human Resources',
      startDate: '20 Jun 2026',
      daysRemaining: 23,
      deliveryLocation: 'Floor 4 · HR Department · Johannesburg office',
    },
    slaStatus: 'ON_TRACK',
    taskStatus: 'UNASSIGNED',
    requiredBy: '20 Jun 2026',
    slaProgress: 35,
    claimedBy: null, claimedByName: null, claimedByRole: null, claimedAt: null,
    hmNote: null, hmName: null, hmRole: null,
    bundleApprovedBy: 'Andre van der Merwe',
    checklist: [
      { id: 'c1', label: 'Desk allocated and confirmed', completed: false },
      { id: 'c2', label: 'Monitor and peripherals sourced', completed: false },
      { id: 'c3', label: 'Ergonomic setup completed', completed: false },
    ],
    activity: [
      { type: 'create', text: 'Task created from approved bundle — Andre van der Merwe', timestamp: '2 days ago', subtext: 'Auto-routed to Facilities queue' },
    ],
  },
  {
    id: 'task-005',
    title: 'Laptop — Finance Analyst spec',
    requirementType: 'Hardware',
    queue: 'Hardware',
    newHire: {
      name: 'Sipho Ndlovu',
      role: 'Finance Analyst',
      seniority: 'Junior',
      department: 'Finance',
      startDate: '25 Jun 2026',
      daysRemaining: 28,
      deliveryLocation: 'Floor 5 · Finance Team · Cape Town office',
    },
    slaStatus: 'ON_TRACK',
    taskStatus: 'UNASSIGNED',
    requiredBy: '25 Jun 2026',
    slaProgress: 20,
    claimedBy: null, claimedByName: null, claimedByRole: null, claimedAt: null,
    hmNote: null, hmName: null, hmRole: null,
    bundleApprovedBy: 'Nomsa Mthembu',
    checklist: [
      { id: 'c1', label: 'Hardware sourced and confirmed available', completed: false },
      { id: 'c2', label: 'Company standard image applied', completed: false },
      { id: 'c3', label: 'Asset tag recorded and logged in inventory system', completed: false },
      { id: 'c4', label: 'Delivery confirmed to correct location', completed: false },
    ],
    activity: [
      { type: 'create', text: 'Task created from approved bundle — Nomsa Mthembu', timestamp: '1 day ago', subtext: 'Auto-routed to Hardware queue' },
    ],
  },
  {
    id: 'task-006',
    title: 'Access setup — Product Manager',
    requirementType: 'Access & Identity',
    queue: 'Access & Identity',
    newHire: {
      name: 'Amara Osei',
      role: 'Product Manager',
      seniority: 'Senior',
      department: 'Product',
      startDate: '1 Jul 2026',
      daysRemaining: 34,
      deliveryLocation: 'Floor 1 · Product Team · Cape Town office',
    },
    slaStatus: 'ON_TRACK',
    taskStatus: 'CLAIMED',
    requiredBy: '1 Jul 2026',
    slaProgress: 15,
    claimedBy: 'specialist-001',
    claimedByName: 'Tom Mokoena',
    claimedByRole: 'Access specialist',
    claimedAt: '3 hours ago',
    hmNote: null, hmName: null, hmRole: null,
    bundleApprovedBy: 'Koketso Nkosi',
    checklist: [
      { id: 'c1', label: 'Active Directory account created', completed: false },
      { id: 'c2', label: 'Email account provisioned', completed: false },
      { id: 'c3', label: 'Jira and Confluence access granted', completed: false },
      { id: 'c4', label: 'Access confirmation sent to hiring manager', completed: false },
    ],
    activity: [
      { type: 'claim',  text: 'Claimed by Tom Mokoena', timestamp: '3 hours ago', subtext: 'Access & Identity queue' },
      { type: 'create', text: 'Task created from approved bundle — Koketso Nkosi', timestamp: '1 day ago', subtext: 'Auto-routed to Access & Identity queue' },
    ],
  },
];

const MOCK_COMPLETED: ItTask[] = [
  {
    id: 'task-100',
    title: 'Laptop — Cloud Engineer spec',
    requirementType: 'Hardware',
    queue: 'Hardware',
    newHire: {
      name: 'Lungisa Mthembu',
      role: 'Cloud Engineer',
      seniority: 'Senior',
      department: 'Engineering',
      startDate: '15 May 2026',
      daysRemaining: 0,
      deliveryLocation: 'Floor 2 · Engineering Hub · Cape Town office',
    },
    slaStatus: 'ON_TRACK',
    taskStatus: 'COMPLETED',
    requiredBy: '15 May 2026',
    slaProgress: 100,
    claimedBy: 'specialist-001',
    claimedByName: 'Tom Mokoena',
    claimedByRole: 'Hardware specialist',
    claimedAt: '8 May 2026',
    hmNote: null, hmName: null, hmRole: null,
    bundleApprovedBy: 'Ignecious Tanaka',
    checklist: [
      { id: 'c1', label: 'Hardware sourced and confirmed available', completed: true },
      { id: 'c2', label: 'Company standard image applied', completed: true },
      { id: 'c3', label: 'Asset tag recorded and logged in inventory system', completed: true },
      { id: 'c4', label: 'Delivery confirmed to correct location', completed: true },
    ],
    activity: [
      { type: 'complete', text: 'Marked complete by Tom Mokoena', timestamp: '12 May 2026', subtext: 'Asset: LT-2024-0901 · MacBook Pro M3 · Space Grey' },
      { type: 'claim',    text: 'Claimed by Tom Mokoena', timestamp: '8 May 2026', subtext: 'Hardware queue' },
      { type: 'create',   text: 'Task created from approved bundle — Ignecious Tanaka', timestamp: '1 May 2026', subtext: 'Auto-routed to Hardware queue' },
    ],
  },
];
