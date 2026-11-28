// REC-09: the one place a rule's conditions are judged (the stream job and the tiles both use it), and the shape of a rule.
export const TARGETS = ['HR_RECRUITMENT', 'HIRING_MANAGER', 'PANEL_MEMBER', 'DECIDER', 'APPROVER'];
export const ACTIONS = ['NOTIFY', 'DRAFT_CANDIDATE_MESSAGE'];

export function evaluateCondition(value, operator, expected) {
  switch (operator) {
    case 'equals': return value === expected;
    case 'notEquals': return value !== expected;
    case 'greaterThan': return value > expected;
    case 'lessThan': return value < expected;
    case 'greaterThanOrEqual': return value >= expected;
    case 'lessThanOrEqual': return value <= expected;
    case 'in': return Array.isArray(expected) && expected.includes(value);
    case 'notIn': return Array.isArray(expected) && !expected.includes(value);
    default: return false;
  }
}
/** { matched, seen } : seen lists each signal the rule read, with its value. */
export function judge(rule, signals) {
  const seen = [];
  for (const c of rule.conditions ?? []) {
    let v = signals?.[c.signal];
    if (v === undefined || v === null) return { matched: false, seen };
    if (c.path && typeof v === 'object') v = v[c.path];
    if (v === undefined || v === null) return { matched: false, seen };
    if (!seen.some((s) => s.signal === c.signal)) seen.push({ signal: c.signal, value: signals[c.signal] });
    if (!evaluateCondition(v, c.operator, c.value)) return { matched: false, seen };
  }
  return { matched: true, seen };
}
// Rules the engine no longer fires (REC-09 rules 1 and changes of 28 Nov; the quiet rules of REC-17 are built in there).
export const RETIRED = ['RULE-EVAL-001', 'RULE-DROP-001', 'RULE-COOLING-001', 'RULE-HIPO-001', 'RULE-FASTTRACK-001', 'RULE-RISK-001'];
