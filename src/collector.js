import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  ECSClient,
  paginateListServices,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';

import { sessionName } from './config.js';

const DESCRIBE_SERVICES_LIMIT = 10;
const ECR_REGISTRY = /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i;

const sts = new STSClient({});
const credentialCache = new Map();

function ecrRepositoryFromImageUri(image = '') {
  const slash = image.indexOf('/');
  if (slash === -1 || !ECR_REGISTRY.test(image.slice(0, slash))) return '';

  const path = image.slice(slash + 1);
  const digest = path.indexOf('@');
  if (digest !== -1) return path.slice(0, digest);

  const tag = path.lastIndexOf(':');
  return tag === -1 ? path : path.slice(0, tag);
}

function assumeRole(roleArn) {
  if (!credentialCache.has(roleArn)) {
    const credentials = sts
      .send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName: sessionName,
        })
      )
      .then(({ Credentials }) => {
        if (!Credentials) throw new Error('AssumeRole returned no credentials');
        return {
          accessKeyId: Credentials.AccessKeyId,
          secretAccessKey: Credentials.SecretAccessKey,
          sessionToken: Credentials.SessionToken,
          expiration: Credentials.Expiration,
        };
      })
      .catch((error) => {
        credentialCache.delete(roleArn);
        throw error;
      });
    credentialCache.set(roleArn, credentials);
  }
  return credentialCache.get(roleArn);
}

async function readClusterName(ssm, ssmParameterName) {
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: ssmParameterName, WithDecryption: true })
  );
  const cluster = Parameter?.Value?.trim();
  if (!cluster) throw new Error(`SSM parameter ${ssmParameterName} is empty`);
  return cluster;
}

async function listServiceArns(ecs, cluster) {
  const serviceArns = [];
  for await (const page of paginateListServices({ client: ecs, pageSize: 100 }, { cluster })) {
    serviceArns.push(...(page.serviceArns ?? []));
  }
  return serviceArns;
}

async function describeServices(ecs, cluster, serviceArns) {
  const batches = Array.from(
    { length: Math.ceil(serviceArns.length / DESCRIBE_SERVICES_LIMIT) },
    (_, i) => serviceArns.slice(i * DESCRIBE_SERVICES_LIMIT, (i + 1) * DESCRIBE_SERVICES_LIMIT)
  );

  const services = [];
  const errors = [];

  for (const result of await Promise.allSettled(
    batches.map((batch) => ecs.send(new DescribeServicesCommand({ cluster, services: batch })))
  )) {
    if (result.status === 'rejected') {
      errors.push(`DescribeServices: ${result.reason.message}`);
      continue;
    }
    services.push(...(result.value.services ?? []));
    errors.push(...(result.value.failures ?? []).map((f) => `service ${f.arn}: ${f.reason}`));
  }

  return { services, errors };
}

async function describeTaskDefinitions(ecs, arns) {
  const taskDefinitions = new Map();
  const errors = [];

  for (const [index, result] of (
    await Promise.allSettled(
      arns.map((arn) => ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: arn })))
    )
  ).entries()) {
    if (result.status === 'rejected') {
      errors.push(`DescribeTaskDefinition ${arns[index]}: ${result.reason.message}`);
      continue;
    }
    taskDefinitions.set(arns[index], result.value.taskDefinition);
  }

  return { taskDefinitions, errors };
}

function toRows(services, taskDefinitions, accountNumber, region, cluster) {
  return services.flatMap((service) =>
    (taskDefinitions.get(service.taskDefinition)?.containerDefinitions ?? []).map((container) => ({
      accountNumber,
      region,
      clusterName: cluster,
      serviceName: service.serviceName,
      serviceArn: service.serviceArn,
      taskDefinitionName: service.taskDefinition.split('/').pop(),
      containerName: container.name ?? '',
      imageUri: container.image ?? '',
      ecrRepositoryName: ecrRepositoryFromImageUri(container.image),
    }))
  );
}

export async function collectTarget({ roleArn, ssmParameterName, region }) {
  if (!roleArn || !ssmParameterName || !region) {
    return { rows: [], errors: [`Invalid config entry: ${JSON.stringify({ roleArn, ssmParameterName, region })}`] };
  }

  const accountNumber = roleArn.split(':')[4] ?? 'unknown';
  const label = `${accountNumber}/${region}`;

  let credentials;
  try {
    credentials = await assumeRole(roleArn);
  } catch (error) {
    return { rows: [], errors: [`${label}: AssumeRole failed: ${error.message}`] };
  }

  const ssm = new SSMClient({ region, credentials });
  const ecs = new ECSClient({ region, credentials });

  try {
    const cluster = await readClusterName(ssm, ssmParameterName);
    const serviceArns = await listServiceArns(ecs, cluster);
    if (serviceArns.length === 0) {
      return { rows: [], errors: [`${label}: cluster ${cluster} has no services`] };
    }

    const described = await describeServices(ecs, cluster, serviceArns);
    const arns = [...new Set(described.services.map((s) => s.taskDefinition).filter(Boolean))];
    const taskDefs = await describeTaskDefinitions(ecs, arns);

    return {
      rows: toRows(described.services, taskDefs.taskDefinitions, accountNumber, region, cluster),
      errors: [...described.errors, ...taskDefs.errors].map((error) => `${label}: ${error}`),
    };
  } catch (error) {
    return { rows: [], errors: [`${label}: ${error.name}: ${error.message}`] };
  } finally {
    ssm.destroy();
    ecs.destroy();
  }
}
