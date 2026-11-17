'use strict';
/** BE-19: an ID token, or claims with no token_use at all (same rule as isIdToken in hr-group.mjs). */
function isIdToken(claims) {
  const t = claims && claims.token_use;
  return t === undefined || t === 'id';
}
module.exports = { isIdToken };
