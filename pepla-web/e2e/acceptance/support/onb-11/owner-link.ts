/**
 * ONB-11 owner link (child locks mod-01.10, onb-03.7, onb-04.4, onb-04.2.2, ten-02.7, ten-03.10).
 * createEmployee writes the new person's sign-in id (user_sub) onto their employees row after it issues the invite, so
 * that person can open their own documents (TEN-02 ownership). That is one UpdateItem on the employees table, for the
 * create_employee role only. Nothing else is allowed through here: not another action, not another table, not another role,
 * and not a policy that carries a condition.
 * Resources are as policyOf reads them from Terraform text.
 */
export function ownerLinkGrant(action: string, resource: string, role: string, condition = 'null'): boolean {
  if (role !== 'create_employee' || condition !== 'null') return false;
  if (action !== 'dynamodb:UpdateItem') return false;
  // The Terraform reference (balanced braces), or the literal address in af-south-1 with a 12-digit account (the baselines use 000000000000).
  return /^(?:\$\{aws_dynamodb_table\.employees\.arn\}|aws_dynamodb_table\.employees\.arn|arn:aws:dynamodb:af-south-1:\d{12}:table\/employees)$/.test(resource);
}
