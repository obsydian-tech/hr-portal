# Monitoring is switched off outside prod (var.enable_prod_monitoring) to keep
# pepla-dev's fixed monthly cost near zero. These moved blocks keep prod's
# existing resources where they are (no destroy/create) after adding count.

moved {
  from = module.config
  to   = module.config[0]
}

moved {
  from = module.dashboards
  to   = module.dashboards[0]
}

moved {
  from = module.alarms
  to   = module.alarms[0]
}

moved {
  from = aws_cloudwatch_dashboard.naleko_ai_poc
  to   = aws_cloudwatch_dashboard.naleko_ai_poc[0]
}
