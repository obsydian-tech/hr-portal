import {
  for_each = var.environment == "prod" ? toset(["prod"]) : toset([])
  to       = aws_cognito_user_pool_client.web_prod[0]
  id       = "${aws_cognito_user_pool.naleko_dev.id}/1pk5rd58glsohfplnlr63tg0qb"
}
