/** MOD-01: the seed registry. One seed per key of MODULE_KEYS (lambda/shared/modules.mjs). */
export const seedFile = (key) => new URL(`./${key}.mjs`, import.meta.url);

/**
 * REC-14 rule 8: company-wide seeds that run before a module's own seed. Departments belong to the whole company, so
 * whichever of Onboarding or Recruitment is switched on first gives the company its list.
 */
const DEPARTMENTS = new URL('../company-seeds/departments.mjs', import.meta.url);
export const companySeedFiles = (key) => (key === 'onboarding' || key === 'recruitment' ? [DEPARTMENTS] : []);
