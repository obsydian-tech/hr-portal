/** MOD-01: the seed registry. One seed per key of MODULE_KEYS (lambda/shared/modules.mjs). */
export const seedFile = (key) => new URL(`./${key}.mjs`, import.meta.url);
