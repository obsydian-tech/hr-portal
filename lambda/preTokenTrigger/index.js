/**
 * Pre-Token Generation Lambda Trigger — TalentFlow
 * Ticket: NH-106 / TF-003
 *
 * Fires before Cognito issues every JWT (access + id tokens).
 * Adds custom:isAdmin = "true" claim for members of the TalentFlowAdmin group.
 *
 * Angular route guards read event.request.groupConfiguration.groupsToOverride
 * via the id token claim — this trigger surfaces it as custom:isAdmin so the
 * frontend doesn't need to inspect raw group arrays.
 */

const ADMIN_GROUP = process.env.ADMIN_GROUP ?? "TalentFlowAdmin";

/**
 * @param {import("aws-lambda").PreTokenGenerationTriggerEvent} event
 */
exports.handler = async (event) => {
  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];
  const isAdmin = groups.includes(ADMIN_GROUP);

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          "custom:isAdmin": isAdmin ? "true" : "false",
        },
      },
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          "custom:isAdmin": isAdmin ? "true" : "false",
        },
      },
    },
  };

  return event;
};
