import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProvisioningBundleProgress } from '../models/talent-flow.models';
import { TalentFlowApiService } from './talent-flow-api.service';

/**
 * TalentFlowProvisioningService
 * Provides the TA/HM read-only view of a candidate's provisioning bundle.
 * Delegates to TalentFlowApiService for real API calls.
 */
@Injectable({ providedIn: 'root' })
export class TalentFlowProvisioningService {
  private readonly api = inject(TalentFlowApiService);

  async getBundleProgressByCandidateId(
    candidateId: string,
  ): Promise<ProvisioningBundleProgress | null> {
    // Find the bundle for this candidate first, then fetch its progress
    const bundles = await firstValueFrom(this.api.getProvisioningBundles());
    const bundle = bundles.find(b => b.candidateId === candidateId);
    if (!bundle) return null;
    return firstValueFrom(this.api.getProvisioningBundleProgress(bundle.id)).then(p => p ?? null);
  }
}

