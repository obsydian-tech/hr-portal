/**
 * MOD-01: the Onboarding seed. Every company already has what Onboarding needs, so it writes nothing.
 * A seed only creates what is missing; it never overwrites or re-versions a setting the company already has.
 */
export const available = true;
export default async function seed() {
  return { written: 0 };
}
