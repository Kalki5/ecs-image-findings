export const configBucket = process.env.CONFIG_BUCKET;
export const configKey = process.env.CONFIG_KEY;
export const outputBucket = process.env.OUTPUT_BUCKET || process.env.CONFIG_BUCKET;
export const outputPrefix = (process.env.OUTPUT_PREFIX || 'ecs-image-inventory').replace(/\/+$/, '');
export const sessionName = process.env.ASSUME_ROLE_SESSION_NAME || 'ecs-image-inventory';
export const collectFindingsEnabled = ['true', '1', 'yes'].includes(
  (process.env.COLLECT_FINDINGS ?? '').toLowerCase()
);
