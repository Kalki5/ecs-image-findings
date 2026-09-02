import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { configBucket, configKey, outputBucket, outputPrefix } from './config.js';
import { collectTarget } from './collector.js';
import { collectFindings } from './inspector.js';
import { createWorkbookStream } from './workbook.js';

const s3 = new S3Client({});

export const handler = async () => {
  if (!configBucket || !configKey) {
    throw new Error('CONFIG_BUCKET and CONFIG_KEY are required');
  }

  const { Body } = await s3.send(
    new GetObjectCommand({ Bucket: configBucket, Key: configKey })
  );
  const targets = JSON.parse(await Body.transformToString());
  if (!Array.isArray(targets)) {
    throw new Error(`Config s3://${configBucket}/${configKey} must be a JSON array of targets`);
  }

  const rows = [];
  const errors = [];

  for (const [index, result] of (
    await Promise.allSettled(targets.map((target) => collectTarget(target)))
  ).entries()) {
    if (result.status === 'rejected') {
      errors.push(`Target ${index}: ${result.reason.message}`);
      continue;
    }
    rows.push(...result.value.rows);
    errors.push(...result.value.errors);
  }

  rows.sort(
    (a, b) =>
      a.accountNumber.localeCompare(b.accountNumber) ||
      a.region.localeCompare(b.region) ||
      a.serviceName.localeCompare(b.serviceName) ||
      a.containerName.localeCompare(b.containerName)
  );

  const findings = await collectFindings(rows);
  errors.push(...findings.errors);

  const key = `${outputPrefix}/ecs-image-inventory-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.xlsx`;
  const { stream, done } = createWorkbookStream(rows, findings.rows, errors);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: outputBucket,
      Key: key,
      Body: stream,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });

  const [uploaded] = await Promise.all([upload.done(), done]);

  const summary = {
    targets: targets.length,
    rows: rows.length,
    findings: findings.rows.length,
    errors,
    report: `s3://${outputBucket}/${key}`,
    etag: uploaded.ETag,
  };
  console.log(JSON.stringify({ message: 'ECS image inventory complete', ...summary }));
  return summary;
};
