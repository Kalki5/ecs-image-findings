import { Inspector2Client, paginateListFindings } from '@aws-sdk/client-inspector2';

import { collectFindingsEnabled } from './config.js';

const REPOSITORY_FILTER_LIMIT = 10;

const inspector = new Inspector2Client({});

function normalizeImageUri(imageUri) {
  const reference = imageUri.slice(imageUri.lastIndexOf('/') + 1);
  return reference.includes(':') || reference.includes('@') ? imageUri : `${imageUri}:latest`;
}

function imageUrisFor(resource) {
  const details = resource.details?.awsEcrContainerImage;
  if (!details?.registry || !details.repositoryName) return [];

  const region = resource.region ?? resource.id?.split(':')[3];
  const repository = `${details.registry}.dkr.ecr.${region}.amazonaws.com/${details.repositoryName}`;

  return [
    ...(details.imageTags ?? []).map((tag) => `${repository}:${tag}`),
    ...(details.imageHash ? [`${repository}@${details.imageHash}`] : []),
  ];
}

function indexServiceArns(inventoryRows) {
  const serviceArnsByImage = new Map();

  for (const row of inventoryRows) {
    if (!row.ecrRepositoryName || !row.imageUri) continue;
    const imageUri = normalizeImageUri(row.imageUri);
    if (!serviceArnsByImage.has(imageUri)) serviceArnsByImage.set(imageUri, new Set());
    if (row.serviceArn) serviceArnsByImage.get(imageUri).add(row.serviceArn);
  }

  return serviceArnsByImage;
}

function toRows(finding, serviceArnsByImage) {
  const vulnerability = finding.packageVulnerabilityDetails;

  return (finding.resources ?? []).flatMap((resource) => {
    const imageUri = imageUrisFor(resource).find((uri) => serviceArnsByImage.has(uri));
    if (!imageUri) return [];

    const details = resource.details.awsEcrContainerImage;
    const packageManagers = new Set(
      (vulnerability?.vulnerablePackages ?? []).map((p) => p.packageManager).filter(Boolean)
    );

    return [
      {
        ecrRepositoryName: details.repositoryName,
        imageId: details.imageHash,
        imageUri,
        serviceArns: [...serviceArnsByImage.get(imageUri)].join(', '),
        vulnerabilityId: vulnerability?.vulnerabilityId ?? '',
        title: finding.title ?? '',
        imagePushedAt: details.pushedAt,
        vulnerabilityPublishedAt: vulnerability?.vendorCreatedAt,
        vulnerabilityDiscoveredAt: finding.firstObservedAt,
        packageManager: [...packageManagers].join(', '),
      },
    ];
  });
}

async function listFindings(repositoryNames) {
  const filterCriteria = {
    findingStatus: [{ comparison: 'EQUALS', value: 'ACTIVE' }],
    resourceType: [{ comparison: 'EQUALS', value: 'AWS_ECR_CONTAINER_IMAGE' }],
    ecrImageRepositoryName: repositoryNames.map((value) => ({ comparison: 'EQUALS', value })),
  };

  const findings = [];
  for await (const page of paginateListFindings({ client: inspector }, { filterCriteria })) {
    findings.push(...(page.findings ?? []));
  }
  return findings;
}

export async function collectFindings(inventoryRows) {
  if (!collectFindingsEnabled) return { rows: [], errors: [] };

  const serviceArnsByImage = indexServiceArns(inventoryRows);
  const repositoryNames = [
    ...new Set(inventoryRows.map((row) => row.ecrRepositoryName).filter(Boolean)),
  ];
  if (repositoryNames.length === 0) return { rows: [], errors: [] };

  const batches = Array.from(
    { length: Math.ceil(repositoryNames.length / REPOSITORY_FILTER_LIMIT) },
    (_, i) =>
      repositoryNames.slice(i * REPOSITORY_FILTER_LIMIT, (i + 1) * REPOSITORY_FILTER_LIMIT)
  );

  const rows = [];
  const errors = [];

  for (const [index, result] of (
    await Promise.allSettled(batches.map((batch) => listFindings(batch)))
  ).entries()) {
    if (result.status === 'rejected') {
      errors.push(
        `Inspector ListFindings [${batches[index].join(', ')}]: ${result.reason.message}`
      );
      continue;
    }
    rows.push(...result.value.flatMap((finding) => toRows(finding, serviceArnsByImage)));
  }

  rows.sort(
    (a, b) =>
      a.ecrRepositoryName.localeCompare(b.ecrRepositoryName) ||
      a.imageUri.localeCompare(b.imageUri) ||
      a.vulnerabilityId.localeCompare(b.vulnerabilityId)
  );

  return { rows, errors };
}
