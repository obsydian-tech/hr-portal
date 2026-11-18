/**
 * MOD-01: the Recruitment seed (the Standard pack). REC-12 owns the pack's content and fills this seed. Until then
 * it writes nothing and prints the line below; set-modules refuses to turn Recruitment on in prod while it does.
 */
export const STANDARD_PACK_LINE = 'Recruitment Standard pack: not available yet (REC-12)';
export const available = false;
export default async function seed({ log }) {
  log(STANDARD_PACK_LINE);
  return { written: 0 };
}
