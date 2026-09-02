# ECS Container Image Inventory Lambda

Reads a JSON config from S3, walks every account/region it names, and writes one
Excel workbook of every container image running in the target ECS clusters.

## Flow

1. `GetObject` the config from S3 (`CONFIG_BUCKET` / `CONFIG_KEY`).
2. For each entry, all in parallel:
   - `sts:AssumeRole` into the entry's `roleArn` (cached per role, reused across regions).
   - `ssm:GetParameter` in the entry's region -> ECS cluster name.
   - `ecs:ListServices` (paginated) -> `ecs:DescribeServices`, all calls in flight.
   - `ecs:DescribeTaskDefinition` once per distinct task definition, all in flight.
3. When `COLLECT_FINDINGS` is on, query Amazon Inspector in the Lambda's own account
   and region for `AWS_ECR_CONTAINER_IMAGE` findings, filtered to the repositories
   collected above, then keep only findings whose image resolves to one of the
   captured image URIs.
4. Stream both sheets into an `.xlsx` and multipart-upload it back to S3.

Failures are scoped: a broken account/region lands on the workbook's `Errors`
sheet and in the handler response instead of failing the whole run.

## Config format

```json
[
  {
    "roleArn": "arn:aws:iam::111122223333:role/EcsInventoryReadOnly",
    "ssmParameterName": "/platform/ecs/cluster-name",
    "region": "us-east-1"
  }
]
```

The config must be a JSON array.

## Sheets

**ECS Container Images** — Account Number (from the role ARN) · Region · ECS Cluster
Name · Service Name · Task Definition Name · Container Name · Image URI · ECR
Repository Name (from the image URI; blank for non-ECR registries).

**Inspector Findings** — ECR Repository Name · Image ID · Image URI · ECS Service
ARNs (every service running that image) · Vulnerability ID · Finding Title · Image
Pushed At · Vulnerability Published Date · Vulnerability Discovered Date · Package
Manager. Empty unless `COLLECT_FINDINGS` is set.

**Errors** — present only when something failed; the run itself still succeeds.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONFIG_BUCKET` | — | Bucket holding the JSON config (required) |
| `CONFIG_KEY` | — | Key of the JSON config (required) |
| `OUTPUT_BUCKET` | `CONFIG_BUCKET` | Where the workbook is written |
| `OUTPUT_PREFIX` | `ecs-image-inventory` | Key prefix for the workbook |
| `ASSUME_ROLE_SESSION_NAME` | `ecs-image-inventory` | STS session name |
| `COLLECT_FINDINGS` | off | Set `true` to add the Inspector Findings sheet |

All of the above are read in one place, `src/config.js`. The handler takes no
input — everything comes from the environment and the config file.

## IAM

Execution role: `s3:GetObject` on the config, `s3:PutObject`+`s3:AbortMultipartUpload`
on the output prefix, `sts:AssumeRole` on every `roleArn` in the config, and
`inspector2:ListFindings` (only when `COLLECT_FINDINGS` is on).

Each target role's policy: `ssm:GetParameter`, `ecs:ListServices`,
`ecs:DescribeServices`, `ecs:DescribeTaskDefinition` (plus `kms:Decrypt` if the
parameter is a `SecureString`), with a trust policy allowing the Lambda role.

## Deploy

```bash
npm run build   # -> function.zip
```

ESM, Node 24+ (`nodejs24.x`). Give it 1024 MB and a 5–15 minute timeout depending
on fleet size.
