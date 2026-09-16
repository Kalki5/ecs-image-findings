variable "lambda_function_name" {
  description = "Name of the Lambda function."
  type        = string
  default     = "ecs-image-inventory-lambda"
}

variable "lambda_role_arn" {
  description = "ARN of the externally created IAM execution role for the Lambda."
  type        = string
}

variable "lambda_memory_size" {
  description = "Memory (MB) allocated to the Lambda."
  type        = number
  default     = 1024
}

variable "config_bucket" {
  description = "S3 bucket holding the JSON config that lists ECS targets (CONFIG_BUCKET)."
  type        = string
}

variable "config_key" {
  description = "S3 key of the JSON config (CONFIG_KEY)."
  type        = string
}

variable "output_bucket" {
  description = "S3 bucket the workbook is written to (OUTPUT_BUCKET). Defaults to config_bucket when empty."
  type        = string
  default     = ""
}

variable "output_prefix" {
  description = "Key prefix for the generated workbook (OUTPUT_PREFIX)."
  type        = string
  default     = "ecs-image-inventory"
}

variable "assume_role_session_name" {
  description = "STS session name used when assuming each target role (ASSUME_ROLE_SESSION_NAME)."
  type        = string
  default     = "ecs-image-inventory"
}

variable "collect_findings" {
  description = "Whether to query Amazon Inspector and add the Inspector Findings sheet (COLLECT_FINDINGS)."
  type        = bool
  default     = true
}

variable "vpc_id" {
  description = "ID of the VPC in which to create the Lambda security group and deploy the function."
  type        = string
}

variable "vpc_subnet_ids" {
  description = "Private subnet IDs (in vpc_id) the Lambda ENIs are placed in. The subnets must have a route to a NAT gateway (or VPC endpoints for S3/STS/SSM/ECS/Inspector) so the function can reach AWS services."
  type        = list(string)
}
