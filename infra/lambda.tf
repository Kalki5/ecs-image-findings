locals {
  lambda_zip_path = "${path.module}/../lambda.zip"
}

resource "aws_security_group" "lambda" {
  name        = "${var.lambda_function_name}-sg"
  description = "Security group for the ${var.lambda_function_name} Lambda ENIs. Outbound-only."
  vpc_id      = var.vpc_id

  # No ingress rules: the Lambda only makes outbound calls
  # (S3, STS, SSM, ECS, Inspector) and never accepts inbound traffic.

  egress {
    description = "Allow all outbound traffic (HTTPS to AWS service endpoints)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.lambda_function_name}-sg"
  }
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

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }
}
