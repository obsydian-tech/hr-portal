'use strict';
/** TEN-05: roles.mjs for the CommonJS handlers (an ES module, loaded once with import()). */
let loaded;
function rolesHelper() {
  if (!loaded) loaded = import('./roles.mjs');
  return loaded;
}
module.exports = { rolesHelper };
