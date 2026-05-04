# ---------------------------------------------------------------------------
# AWS Config — NH-36
# Calls the config module: recorder, delivery channel, 5 managed rules +
# 1 custom af-south-1 region-enforcement rule with Lambda
# ---------------------------------------------------------------------------

module "config" {
  source = "./modules/config"

  region           = var.aws_region
  environment      = var.environment
  account_id       = var.aws_account_id
  ops_sns_topic_arn = module.alarms.sns_topic_arn
  lambda_role_arn  = local.lambda_role_arn
  placeholder_zip  = local.placeholder_zip
  config_lambda_zip = "${path.root}/../lambda_configregioncheck.zip"
}
