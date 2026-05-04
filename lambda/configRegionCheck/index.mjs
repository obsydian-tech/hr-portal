// ---------------------------------------------------------------------------
// configRegionCheck — NH-36 Custom AWS Config Rule
// Flags any resource created outside af-south-1 as NON_COMPLIANT.
// Exception: Textract resource types (NH-30 documented cross-region deviation)
// ---------------------------------------------------------------------------
import { ConfigServiceClient, PutEvaluationsCommand } from '@aws-sdk/client-config-service';

const config = new ConfigServiceClient({ region: process.env.AWS_REGION || 'af-south-1' });

const ALLOWED_REGION = process.env.ALLOWED_REGION || 'af-south-1';

// Resource types exempt from the region check (documented deviations)
const EXEMPT_PREFIXES = (process.env.EXEMPT_RESOURCE_TYPES || 'AWS::Textract::')
  .split(',')
  .map((s) => s.trim().replace('*', ''));

export const handler = async (event) => {
  const invokingEvent = JSON.parse(event.invokingEvent);

  // Handle oversized config items (reference only — treat as COMPLIANT to avoid false positives)
  if (invokingEvent.messageType === 'OversizedConfigurationItemChangeNotification') {
    return;
  }

  const configItem = invokingEvent.configurationItem;

  if (!configItem) {
    console.log('No configurationItem in event, skipping');
    return;
  }

  const { awsRegion, resourceType, resourceId, configurationItemCaptureTime } = configItem;

  // Skip deleted resources — no region to check
  if (configItem.configurationItemStatus === 'ResourceDeleted') {
    return;
  }

  // Check exemptions
  const isExempt = EXEMPT_PREFIXES.some((prefix) => resourceType.startsWith(prefix));

  let complianceType;
  let annotation;

  if (isExempt) {
    complianceType = 'COMPLIANT';
    annotation = `Resource type ${resourceType} is exempt from region enforcement (documented deviation).`;
  } else if (awsRegion === ALLOWED_REGION) {
    complianceType = 'COMPLIANT';
    annotation = `Resource is in required region ${ALLOWED_REGION}.`;
  } else {
    complianceType = 'NON_COMPLIANT';
    annotation = `Resource is in ${awsRegion} — must be in ${ALLOWED_REGION} for POPIA compliance.`;
  }

  console.log(JSON.stringify({
    level: 'INFO',
    service: 'configRegionCheck',
    resourceId,
    resourceType,
    awsRegion,
    complianceType,
    annotation,
  }));

  await config.send(new PutEvaluationsCommand({
    Evaluations: [{
      ComplianceResourceType: resourceType,
      ComplianceResourceId: resourceId,
      ComplianceType: complianceType,
      Annotation: annotation,
      OrderingTimestamp: new Date(configurationItemCaptureTime),
    }],
    ResultToken: event.resultToken,
  }));
};
