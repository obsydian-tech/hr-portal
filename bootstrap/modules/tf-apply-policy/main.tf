# ---------------------------------------------------------------------------
# The one apply policy shared by pepla-github-tf-apply-dev and
# pepla-github-tf-apply-prod (OPS-05).
#
# policy.json.tftpl is the whole policy. Dev applies with exactly the same
# rules as prod, so a missing permission shows up on a develop merge, not on a
# release. When dev finds one, add that single action, never a wildcard.
#
# AWS caps a managed policy at 6,144 characters, so the statements are split
# into a few managed policies by Sid (see local.parts). Every Sid must be in
# exactly one part; a plan fails if one is missing or a part is too big.
# Explicit Deny statements hold across all the parts.
# ---------------------------------------------------------------------------

variable "name" {
  description = "Prefix of the managed policy names, e.g. pepla-github-tf-apply-prod."
  type        = string
}

variable "account_id" {
  description = "The account the apply role lives in and may change."
  type        = string
}

variable "state_bucket" {
  description = "The account's Terraform state bucket."
  type        = string
}

variable "region" {
  description = "The only region the role may work in."
  type        = string
  default     = "af-south-1"
}

locals {
  document = jsondecode(templatefile("${path.module}/policy.json.tftpl", {
    account_id   = var.account_id
    state_bucket = var.state_bucket
    region       = var.region
  }))

  parts = {
    "1-state-and-read" = [
      "StateBucketList", "StateFiles", "StateLocks", "ReadConfiguration", "AgentKeySecrets",
      "ParametersReadAtPlan", "DecryptOnlyThroughSecretsAndParameters", "AiSpendBudget", "IamRead",
    ]
    "2-manage" = ["ManageStackResources", "ManageCallsWithoutResourceArns"]
    "3-workload-iam" = [
      "WorkloadRoles", "WorkloadRoleManagedPolicies", "PassWorkloadRolesToTheirServices", "AiBrakePolicyVersions",
      "DenyOutsideCapeTown", "DenyPaidAi",
    ]
    "4-denies" = [
      "DenyRunningOrReadingData", "DenyObjectsOutsideState", "DenyOtherSecretsAndParameters", "DenyDeletingProtectedData",
      "DenyDeletingProtectedBuckets", "DenyStateBucketSettings", "DenyTouchingCiRoles",
      "DenyLongLivedCredentialsAndIdentityProviders", "DenyBroadManagedPolicies", "DenyReleasingTheAiBrake",
      "DenyDeletingTheAiBrakePolicy", "DenyAiBudgetRemovalAndRelease", "DenyAccountAndBilling",
    ]
  }

  sids     = [for s in local.document.Statement : s.Sid]
  assigned = flatten(values(local.parts))

  policies = {
    for part, sids in local.parts : part => jsonencode({
      Version   = local.document.Version
      Statement = [for s in local.document.Statement : s if contains(sids, s.Sid)]
    })
  }
}

resource "aws_iam_policy" "part" {
  for_each = local.policies

  name        = "${var.name}-${each.key}"
  description = "Terraform apply rights, part ${each.key} (OPS-05; bootstrap/modules/tf-apply-policy)"
  policy      = each.value

  lifecycle {
    precondition {
      condition     = length(setsubtract(local.sids, local.assigned)) == 0 && length(local.assigned) == length(distinct(local.assigned))
      error_message = "Every Sid in policy.json.tftpl must be in exactly one part in local.parts."
    }
    precondition {
      condition     = length(each.value) <= 6144
      error_message = "This part of the apply policy is over AWS's 6,144 character limit; move a statement to another part."
    }
  }
}

output "policy_arns" {
  description = "ARNs of the managed policies that together make the apply policy."
  value       = [for k in sort(keys(local.parts)) : aws_iam_policy.part[k].arn]
}

output "part_count" {
  description = "How many managed policies the apply policy is split into (known at plan time)."
  value       = length(local.parts)
}
