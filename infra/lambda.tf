locals {
  lambda_zip_path = "${path.module}/../lambda.zip"
}

resource "aws_lambda_function" "ecs_image_inventory" {
  function_name = var.lambda_function_name
  role          = var.lambda_role_arn

  filename         = local.lambda_zip_path
  source_code_hash = filebase64sha256(local.lambda_zip_path)

  handler = "index.handler"
  runtime = "nodejs24.x"

  memory_size = var.lambda_memory_size
  timeout     = 900

  environment {
    variables = {
      CONFIG_BUCKET            = var.config_bucket
      CONFIG_KEY               = var.config_key
      OUTPUT_BUCKET            = var.output_bucket != "" ? var.output_bucket : var.config_bucket
      OUTPUT_PREFIX            = var.output_prefix
      ASSUME_ROLE_SESSION_NAME = var.assume_role_session_name
      COLLECT_FINDINGS         = var.collect_findings ? "true" : "false"
    }
  }
}
