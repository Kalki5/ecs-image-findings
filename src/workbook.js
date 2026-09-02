import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

const DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss';

const INVENTORY_COLUMNS = [
  { header: 'Account Number', key: 'accountNumber', width: 18 },
  { header: 'Region', key: 'region', width: 16 },
  { header: 'ECS Cluster Name', key: 'clusterName', width: 30 },
  { header: 'Service Name', key: 'serviceName', width: 36 },
  { header: 'Task Definition Name', key: 'taskDefinitionName', width: 34 },
  { header: 'Container Name', key: 'containerName', width: 28 },
  { header: 'Image URI', key: 'imageUri', width: 80 },
  { header: 'ECR Repository Name', key: 'ecrRepositoryName', width: 40 },
];

const FINDING_COLUMNS = [
  { header: 'ECR Repository Name', key: 'ecrRepositoryName', width: 40 },
  { header: 'Image ID', key: 'imageId', width: 74 },
  { header: 'Image URI', key: 'imageUri', width: 80 },
  { header: 'ECS Service ARNs', key: 'serviceArns', width: 90 },
  { header: 'Vulnerability ID', key: 'vulnerabilityId', width: 22 },
  { header: 'Finding Title', key: 'title', width: 70 },
  { header: 'Image Pushed At', key: 'imagePushedAt', width: 22, style: { numFmt: DATE_FORMAT } },
  { header: 'Vulnerability Published Date', key: 'vulnerabilityPublishedAt', width: 26, style: { numFmt: DATE_FORMAT } },
  { header: 'Vulnerability Discovered Date', key: 'vulnerabilityDiscoveredAt', width: 26, style: { numFmt: DATE_FORMAT } },
  { header: 'Package Manager', key: 'packageManager', width: 22 },
];

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).commit();
  for (const row of rows) sheet.addRow(row).commit();
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
  sheet.commit();
}

export function createWorkbookStream(inventoryRows, findingRows, errors) {
  const stream = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });

  const done = (async () => {
    addSheet(workbook, 'ECS Container Images', INVENTORY_COLUMNS, inventoryRows);
    addSheet(workbook, 'Inspector Findings', FINDING_COLUMNS, findingRows);

    if (errors.length > 0) {
      addSheet(
        workbook,
        'Errors',
        [{ header: 'Error', key: 'error', width: 140 }],
        errors.map((error) => ({ error }))
      );
    }

    await workbook.commit();
  })();

  done.catch((error) => stream.destroy(error));
  return { stream, done };
}
