# ---------------------------------------------------------------------------
# Resources owned by talent-flow-infra/, not by this stack
#
# manageTalentFlowConfig and adminGetUsers (role, policy, Lambda, integration,
# routes, permission) were declared in BOTH stacks. In prod both states track the
# same AWS objects, so each apply flips them to its own version: that is the
# admin_get_users / manage_talent_flow_config drift. In a fresh account the two
# stacks collide ("role already exists").
#
# talent-flow-infra/ has the complete, current definitions (it also owns the
# POST/PUT/DELETE admin user routes), so it keeps them. These blocks make this
# stack forget its copies WITHOUT deleting anything in AWS.
# ---------------------------------------------------------------------------

removed {
  from = aws_iam_role.manage_talent_flow_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role_policy.manage_talent_flow_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_lambda_function.manage_talent_flow_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_apigatewayv2_integration.manage_talent_flow_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_apigatewayv2_route.get_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_apigatewayv2_route.put_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_apigatewayv2_route.post_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_lambda_permission.manage_talent_flow_config_apigw

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role.admin_get_users

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role_policy.admin_get_users

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_lambda_function.admin_get_users

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_apigatewayv2_integration.admin_get_users

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_apigatewayv2_route.admin_get_users

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_lambda_permission.apigw_admin_get_users

  lifecycle {
    destroy = false
  }
}
