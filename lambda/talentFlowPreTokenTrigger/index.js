'use strict';

/**
 * Cognito Pre-Token Generation trigger — NH-121 / BE-005
 *
 * Adds custom:isAdmin = 'true' when the authenticating user is a member of the
 * TalentFlowAdmin Cognito group, otherwise sets it to 'false'.
 *
 * This claim is consumed by manageTalentFlowConfig to guard POST/PUT routes.
 *
 * @param {import('@types/aws-lambda').PreTokenGenerationTriggerHandler} event
 */
exports.handler = async (event) => {
  const groups = (event.request &&
    event.request.groupConfiguration &&
    event.request.groupConfiguration.groupsToOverride) || [];

  const isAdmin = groups.includes('TalentFlowAdmin') ? 'true' : 'false';

  event.response = event.response || {};
  event.response.claimsOverrideDetails = event.response.claimsOverrideDetails || {};
  event.response.claimsOverrideDetails.claimsToAddOrOverride =
    event.response.claimsOverrideDetails.claimsToAddOrOverride || {};

  event.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin'] = isAdmin;

  return event;
};
