import { lambdaNamed, policyLines, roleInfo, roleResourceOf, valueOf } from '../mod-01/iam';

/**
 * ONB-10: what each Lambda's role may do, read from both Terraform stacks as text (as MOD-01 and ONB-20 read it).
 * Every "Effect action resource condition" line of every inline policy of the function's role, sorted.
 */
export function rolePairsOf(fn: string): { found: boolean; pairs: string[] } {
  const found = lambdaNamed(fn);
  if (found.length !== 1) return { found: false, pairs: [] };
  const { stack, block } = found[0]!;
  const r = roleResourceOf(block);
  const info = r ? roleInfo(stack, r) : undefined;
  if (!r || !info) return { found: false, pairs: [] };
  const all = policyLines();
  const mine = Object.values(all).filter((p) => (p.stack === stack && p.role === r) || valueOf(p.stack, p.role) === info.name);
  const pairs = mine.flatMap((p) => p.pairs ?? [`unreadable ${p.squash}`]);
  return { found: true, pairs: [...new Set(pairs)].sort() };
}
