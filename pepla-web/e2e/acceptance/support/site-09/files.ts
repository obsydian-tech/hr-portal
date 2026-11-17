import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');

/**
 * SITE-09 AC-12, the file rule. The same base rules as SITE-03, SITE-04, SITE-07 and SITE-08: the base is the merge-base of HEAD with origin/develop (else develop);
 * in CI, where the pull request's merge commit is checked out with no develop branch, it is the merge commit's first parent (fetch depth 2 of GITHUB_SHA when
 * needed), never the commit itself (an empty diff there would skip the check for good). `--no-renames`, so a moved file shows as its two paths.
 */
export function changedFiles(): string[] {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: PEPLA_WEB, encoding: 'utf8' }).trim();
  let base = '';
  for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
  if (!base && process.env['GITHUB_ACTIONS'] === 'true') {
    try { git('rev-parse', '--verify', '-q', 'HEAD^1'); } catch { git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD')); }
    try { base = git('rev-parse', 'HEAD^1'); } catch { /* stays empty */ }
    if (base && base === git('rev-parse', 'HEAD')) base = '';
  }
  if (!base) throw new Error('develop is known (git merge-base HEAD origin/develop): no base');
  return git('diff', '--name-only', '--no-renames', base, 'HEAD', '--', '.').split('\n').filter(Boolean).map((f: string) => f.replace(/^pepla-web\//, ''));
}

/** A pull request that changes none of this card's files has nothing to judge here (it is another card's). */
export const isThisCard = (f: string): boolean => /^src\/app\/ds\/site\/learn\/recruitment\//.test(f) || /^e2e\/acceptance\/(site-09\.spec\.ts|support\/site-09\/|cards\/site-09\.md$)/.test(f);

/**
 * What SITE-09 may change (spec AC-12): the site's own folder, the public pages, the two route files `site.routes.ts` and `app.routes.server.ts`, and the site
 * tests (`site-NN`, two digits, as the earlier cards' lists are widened to). Whole paths, anchored at both ends. `app.routes.ts` and the design system README are
 * not in the list: this card adds no gallery route and edits no README.
 */
export const allowed = (f: string): boolean =>
  /^src\/app\/ds\/site\/(?!\.\.)[\w./-]+$/.test(f) ||
  /^src\/app\/features\/public\/[\w./-]+$/.test(f) ||
  /^src\/app\/(app\.routes\.server|site\.routes)\.ts$/.test(f) ||
  /^e2e\/acceptance\/site-\d{2}\.spec\.ts$/.test(f) ||
  /^e2e\/acceptance\/cards\/site-\d{2}\.md$/.test(f) ||
  /^e2e\/acceptance\/support\/site-\d{2}\/[\w./-]+$/.test(f);

/** Always refused, even where the allow-list would match: the signed-in code and the generated list. */
export const refused = (f: string): boolean => f === 'src/app/ds/all.ts' || (f.startsWith('src/app/features/') && !f.startsWith('src/app/features/public/'));

export const outside = (files: string[]): string[] => files.filter((f) => !allowed(f) || refused(f) || /\.\.|\/\.output\//.test(f));

/** Code with its comments taken out, so a name in a comment does not count as the thing itself. */
export const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
