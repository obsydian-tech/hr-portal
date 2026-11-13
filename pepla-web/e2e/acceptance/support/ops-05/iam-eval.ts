/**
 * A small, strict IAM policy evaluator for the OPS-05 checks, so the apply
 * role's policy text can be tested without AWS. It follows AWS's order: an
 * explicit Deny wins, then any Allow, otherwise the call is implicitly denied.
 *
 * It errs towards "denied" only where that cannot hide a gap: a condition
 * operator it does not know makes an Allow statement not apply (so a
 * permission the role needs shows up as missing) and makes a Deny statement
 * not apply either (so a deny the tests rely on must be one it understands).
 * The verifier repeats the important calls with AWS's own policy simulator on
 * the second pass.
 */

export type Statement = {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Condition?: Record<string, Record<string, string | string[] | boolean>>;
  Principal?: unknown;
};
export type Policy = { Version?: string; Statement: Statement | Statement[] };

export type Request = { action: string; resource: string; context?: Record<string, string | string[]> };
export type Decision = 'allowed' | 'explicit-deny' | 'implicit-deny';

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function wildcard(pattern: string, value: string, ignoreCase: boolean): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .split('')
        .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\/]/g, '\\$&')))
        .join('') +
      '$',
    ignoreCase ? 'is' : 's',
  );
  return re.test(value);
}

const actionMatches = (patterns: string[], action: string) => patterns.some((p) => wildcard(p, action, true));
const resourceMatches = (patterns: string[], resource: string) => patterns.some((p) => wildcard(p, resource, false));

/** undefined = operator not understood. */
function conditionHolds(op: string, key: string, expected: string[], ctx: Record<string, string | string[]>): boolean | undefined {
  let base = op;
  let set: 'any' | 'all' | undefined;
  if (base.startsWith('ForAnyValue:')) {
    set = 'any';
    base = base.slice('ForAnyValue:'.length);
  } else if (base.startsWith('ForAllValues:')) {
    set = 'all';
    base = base.slice('ForAllValues:'.length);
  }
  const ifExists = base.endsWith('IfExists');
  if (ifExists) base = base.slice(0, -'IfExists'.length);

  const found = Object.keys(ctx).find((k) => k.toLowerCase() === key.toLowerCase());
  const present = found !== undefined;
  const values = present ? list(ctx[found]) : [];

  if (base === 'Null') {
    const wantNull = expected.map((e) => String(e)).includes('true');
    return wantNull ? !present : present;
  }

  const positive: Record<string, (want: string, got: string) => boolean> = {
    StringEquals: (w, g) => w === g,
    StringEqualsIgnoreCase: (w, g) => w.toLowerCase() === g.toLowerCase(),
    StringLike: (w, g) => wildcard(w, g, false),
    ArnEquals: (w, g) => w === g,
    ArnLike: (w, g) => wildcard(w, g, false),
    Bool: (w, g) => String(w).toLowerCase() === g.toLowerCase(),
  };
  const negated: Record<string, string> = {
    StringNotEquals: 'StringEquals',
    StringNotEqualsIgnoreCase: 'StringEqualsIgnoreCase',
    StringNotLike: 'StringLike',
    ArnNotEquals: 'ArnEquals',
    ArnNotLike: 'ArnLike',
  };

  const isNeg = base in negated;
  const fn = positive[isNeg ? negated[base] : base];
  if (!fn) return undefined;

  if (!present) return ifExists || isNeg ? true : set === 'all';
  const one = (g: string) => expected.some((w) => fn(String(w), g));
  let matched: boolean;
  if (set === 'all') matched = values.every(one);
  else matched = values.some(one);
  return isNeg ? !matched : matched;
}

type Applies = boolean | 'unknown';

function statementApplies(s: Statement, r: Request): Applies {
  const ctx = { 'aws:RequestedRegion': 'af-south-1', ...(r.context ?? {}) };
  if (s.Action !== undefined && !actionMatches(list(s.Action), r.action)) return false;
  if (s.NotAction !== undefined && actionMatches(list(s.NotAction), r.action)) return false;
  if (s.Action === undefined && s.NotAction === undefined) return false;
  if (s.Resource !== undefined && !resourceMatches(list(s.Resource), r.resource)) return false;
  if (s.NotResource !== undefined && resourceMatches(list(s.NotResource), r.resource)) return false;
  for (const [op, keys] of Object.entries(s.Condition ?? {})) {
    for (const [key, want] of Object.entries(keys)) {
      const expected = (Array.isArray(want) ? want : [want]).map((w) => String(w));
      const holds = conditionHolds(op, key, expected, ctx);
      if (holds === undefined) return 'unknown';
      if (!holds) return false;
    }
  }
  return true;
}

export function statements(p: Policy | Policy[]): Statement[] {
  return (Array.isArray(p) ? p : [p]).flatMap((x) => (Array.isArray(x.Statement) ? x.Statement : [x.Statement]));
}

export function decide(policies: Policy | Policy[], r: Request): Decision {
  const all = statements(policies);
  if (all.some((s) => s.Effect === 'Deny' && statementApplies(s, r) === true)) return 'explicit-deny';
  if (all.some((s) => s.Effect === 'Allow' && statementApplies(s, r) === true)) return 'allowed';
  return 'implicit-deny';
}

/** Operators the evaluator met but does not understand (they never allow or deny anything here). */
export function unknownOperators(policies: Policy | Policy[]): string[] {
  const seen = new Set<string>();
  for (const s of statements(policies)) {
    for (const op of Object.keys(s.Condition ?? {})) {
      if (conditionHolds(op, 'x', ['x'], { x: 'x' }) === undefined) seen.add(op);
    }
  }
  return [...seen];
}
