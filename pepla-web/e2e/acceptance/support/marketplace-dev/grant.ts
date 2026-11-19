/**
 * Ask Batsi dev Marketplace grant (child locks ten-03.8 and mod-01.8). On first use Bedrock checks the model's Marketplace
 * subscription and denies InvokeModel without these two rights (Iggie, 19 Nov 2026, PR 433). PR 437 (CHAT-02) moves them out of the
 * chat role's main policy (which TEN-02 AC-13 must read) into a policy of their own. The locked IAM checks of ten-03 AC-10
 * and mod-01 AC-8 allow exactly that policy and nothing broader:
 *  - Terraform resource aws_iam_role_policy.naleko_ai_chat_ask_batsi_marketplace in infra/, on aws_iam_role.naleko_ai_chat;
 *    its label holds ask_batsi, which the CHAT-02 re-lock skips by name, so both checks judge this key BEFORE that skip;
 *  - created in dev only: count = var.environment == "dev" ? 1 : 0, so prod never gets it;
 *  - exactly Allow aws-marketplace:ViewSubscriptions and aws-marketplace:Subscribe on "*" (these actions take no other
 *    resource), with no condition, and nothing else.
 * Any other new role policy on the chat role (any name) is judged by the same rule, so it fails: a renamed copy cannot
 * slip through the CHAT-02 ask_batsi name skip. NotAction, NotResource, NotPrincipal and Deny are refused too.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../infra-harness';

export const MARKETPLACE_DEV_KEY = 'infra/naleko_ai_chat_ask_batsi_marketplace';
const PAIRS = ['Allow aws-marketplace:Subscribe * null', 'Allow aws-marketplace:ViewSubscriptions * null'];

/** The text of the one infra/ resource block with this label, comments removed; '' when missing or not exactly one. */
function blockText(): string {
  const dir = join(REPO, 'infra');
  const found: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.tf'))) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    const re = /resource\s+"aws_iam_role_policy"\s+"naleko_ai_chat_ask_batsi_marketplace"\s*\{/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let depth = 1, i = m.index + m[0].length;
      while (i < src.length && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
      found.push(src.slice(m.index, i));
    }
  }
  return found.length === 1 ? found[0]! : '';
}

/** True when this new role policy is the dev Marketplace grant, exactly as above. */
export function marketplaceDev(key: string, role: string, pairs: string[] | undefined): boolean {
  if (key !== MARKETPLACE_DEV_KEY || role !== 'naleko_ai_chat') return false;
  if (JSON.stringify([...(pairs ?? [])].sort()) !== JSON.stringify(PAIRS)) return false;
  const text = blockText().replace(/\s+/g, ' ');
  return /\bcount = var\.environment == "dev" \? 1 : 0\b/.test(text) && /\brole = aws_iam_role\.naleko_ai_chat\.(name|id)\b/.test(text) && !/\bfor_each\b|\bdynamic\b|\bConditio|\bNot(Action|Resource|Principal)\b|"Deny"/.test(text);
}
