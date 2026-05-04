output "key_id" {
  description = "The globally unique KMS key ID."
  value       = aws_kms_key.this.key_id
}

output "key_arn" {
  description = "The ARN of the KMS key."
  value       = aws_kms_key.this.arn
}

output "alias_arn" {
  description = "The ARN of the KMS alias."
  value       = aws_kms_alias.this.arn
}

output "alias_name" {
  description = "The alias name (with the alias/ prefix)."
  value       = aws_kms_alias.this.name
}
