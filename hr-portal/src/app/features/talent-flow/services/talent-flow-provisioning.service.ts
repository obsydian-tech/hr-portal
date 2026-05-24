import { Injectable } from '@angular/core';
import {
  ProvisioningBundleProgress,
  ProvisioningItemProgress,
  ActivityLogEntry,
} from '../models/talent-flow.models';

/**
 * TalentFlowProvisioningService
 * Provides the TA read-only view of a candidate's provisioning bundle.
 * No actions — visibility only.
 * Replace mock with real API call when backend is live.
 */
@Injectable({ providedIn: 'root' })
export class TalentFlowProvisioningService {

  async getBundleProgressByCandidateId(
    candidateId: string,
  ): Promise<ProvisioningBundleProgress | null> {
    return Promise.resolve(
      MOCK_BUNDLES.find(b => b.candidateId === candidateId) ?? null,
    );
  }
}

// ─── Mock data ─────────────────────────────────────────────────────────────

const MOCK_BUNDLES: ProvisioningBundleProgress[] = [
  {
    id:             'bundle-001',
    candidateId:    'cand-001',
    candidateName:  'Priya Naidoo',
    candidateRole:  'Data Analyst',
    seniority:      'Mid',
    department:     'Analytics',
    startDate:      '2026-06-02',
    templateName:   'Senior Mid Analyst template',
    bundleStatus:   'IN_FULFILMENT',
    slaStatus:      'AT_RISK',
    approvedAt:     '2026-05-15T09:00:00Z',
    items: [
      {
        id:                'item-001',
        type:              'HARDWARE',
        label:             'Laptop',
        queue:             'Hardware queue',
        status:            'COMPLETE',
        fromTemplate:      true,
        specialistName:    'Tom Mokoena',
        specialistInitials:'TM',
        completedAt:       '2026-05-20T11:00:00Z',
        taskSlaStatus:     'ON_TRACK',
      } as ProvisioningItemProgress,
      {
        id:                'item-002',
        type:              'ACCESS',
        label:             'Email account',
        queue:             'Access & Identity queue',
        status:            'COMPLETE',
        fromTemplate:      true,
        specialistName:    'Kim Langa',
        specialistInitials:'KL',
        completedAt:       '2026-05-21T14:30:00Z',
        taskSlaStatus:     'ON_TRACK',
      } as ProvisioningItemProgress,
      {
        id:                'item-003',
        type:              'FACILITIES',
        label:             'Access card',
        queue:             'Facilities queue',
        status:            'COMPLETE',
        fromTemplate:      true,
        specialistName:    'Nomsa Zulu',
        specialistInitials:'NZ',
        completedAt:       '2026-05-22T09:15:00Z',
        taskSlaStatus:     'ON_TRACK',
      } as ProvisioningItemProgress,
      {
        id:                'item-004',
        type:              'SOFTWARE',
        label:             'System access',
        queue:             'Software queue',
        status:            'BREACHED',
        fromTemplate:      true,
        specialistName:    undefined,
        specialistInitials:undefined,
        completedAt:       undefined,
        taskSlaStatus:     'BREACHED',
      } as ProvisioningItemProgress,
    ],
    activityLog: [
      {
        id:      'al-001',
        type:    'BREACH',
        message: 'System access breached — unassigned in Software queue. HM escalated.',
        detail:  'Today',
      },
      {
        id:      'al-002',
        type:    'COMPLETE',
        message: 'Access card complete — Nomsa Z. · Facilities queue',
        detail:  'Yesterday',
      },
      {
        id:      'al-003',
        type:    'COMPLETE',
        message: 'Email account complete — Kim L. · Access & Identity',
        detail:  '2 days ago',
      },
      {
        id:      'al-004',
        type:    'COMPLETE',
        message: 'Laptop complete — Tom M. · Hardware queue',
        detail:  '3 days ago',
      },
      {
        id:      'al-005',
        type:    'INFO',
        message: 'HM review SLA at risk — reminder sent to Marcus K.',
        detail:  '6 days ago',
      },
      {
        id:      'al-006',
        type:    'APPROVAL',
        message: 'Bundle approved — Marcus Khumalo · tasks routed to queues',
        detail:  '7 days ago',
      },
      {
        id:      'al-007',
        type:    'INFO',
        message: 'Bundle auto-created — offer accepted · Senior Mid Analyst template',
        detail:  '8 days ago',
      },
    ] as ActivityLogEntry[],
  },
];
