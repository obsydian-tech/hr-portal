/**
 * @deprecated ItProvisioningAuthService is REMOVED.
 *
 * The IT Provisioning module shares the TalentFlow Cognito pool.
 * Replace all usages with TalentFlowAuthService:
 *
 *   import { TalentFlowAuthService } from '../../talent-flow/services/talent-flow-auth.service';
 *   readonly tfAuth = inject(TalentFlowAuthService);
 *   tfAuth.isItSpecialist  // ITAdmin | ITSpecialist group check
 *
 * This file re-exports TalentFlowAuthService under the old name as a
 * build-safe migration shim.  Delete once all consumers are updated.
 */
export { TalentFlowAuthService as ItProvisioningAuthService } from '../../talent-flow/services/talent-flow-auth.service';
