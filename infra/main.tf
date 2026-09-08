terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
  }

  backend "s3" {
    bucket         = ""
    key            = ""
    region         = "us-east-1"
    use_lockfile   = true
  }
}

provider "aws" {}
