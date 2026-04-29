import fs from 'fs-extra';
import path from 'path';
import type { DetectIssueReporter, ProfileDetector, ProfileSlug } from './IngestProfile.js';

const detectors: ProfileDetector[] = [
  {
    slug: 'first-example',
    displayName: 'First Example',
    async probe(root, onIssue) {
      const evidence: string[] = [];
      // Object Definition.csv at root of object-defs dir
      const objectDefinitionCsv = await findFile(root, file => path.basename(file).toLowerCase() === 'object definition.csv');
      if (objectDefinitionCsv) {
        evidence.push(`Object Definition.csv found at ${relativeEvidencePath(root, objectDefinitionCsv)}`);
      }
      // RoleToRuleInformation.csv present
      const roleToRuleInformationCsv = await findFile(
        root,
        file => path.basename(file).toLowerCase() === 'roletoruleinformation.csv'
      );
      if (roleToRuleInformationCsv) {
        evidence.push(
          `RoleToRuleInformation.csv found at ${relativeEvidencePath(root, roleToRuleInformationCsv)} (first-example RBP format)`
        );
      }
      // WFInfo.csv present (combined workflow)
      const wfInfoCsv = await findFile(root, file => path.basename(file).toLowerCase() === 'wfinfo.csv');
      if (wfInfoCsv) {
        evidence.push(`WFInfo.csv found at ${relativeEvidencePath(root, wfInfoCsv)} (combined workflow format)`);
      }
      // jobResponse CSV present
      const jobResponseCsv = await findFile(
        root,
        file => path.basename(file).toLowerCase().startsWith('jobresponse') && file.toLowerCase().endsWith('.csv')
      );
      if (jobResponseCsv) {
        evidence.push(
          `jobResponse*.csv found at ${relativeEvidencePath(root, jobResponseCsv)} (first-example rules assignment)`
        );
      }
      // RBP v1 JSON: look for {role, perms, assigns} structure
      const rbpJsonDir = await findSubdir(root, ['roletopermissionjsons']);
      if (rbpJsonDir) {
        const jsonFiles = (await safeReaddir(rbpJsonDir)).filter(f => f.endsWith('.json'));
        if (jsonFiles.length > 0) {
          try {
            const sample = await fs.readJson(path.join(rbpJsonDir, jsonFiles[0]));
            if ('role' in sample && 'perms' in sample) {
              evidence.push(`RBP JSON v1 schema detected in ${relativeEvidencePath(root, rbpJsonDir)} (role/perms/assigns)`);
            }
          } catch (err) {
            onIssue?.({
              code: 'detect.rbpJson.parseError',
              message: `Could not parse RBP JSON sample for first-example v1 probe: ${(err as Error).message}`,
              file: jsonFiles[0]
            });
          }
        }
      }
      return { confidence: evidence.length / 4, evidence };
    }
  },
  {
    slug: 'client-2',
    displayName: 'Client 2',
    async probe(root, onIssue) {
      const evidence: string[] = [];
      // Sibling workflow split bundle
      const workflowCsv = await findFile(root, file => path.basename(file).toLowerCase() === 'workflow.csv');
      const workflowCcRoleCsv = await findFile(root, file => path.basename(file).toLowerCase() === 'workflowccrole.csv');
      const hasSplitWorkflow = !!(workflowCsv && workflowCcRoleCsv);
      if (hasSplitWorkflow) {
        evidence.push(
          `Split workflow bundle detected (${relativeEvidencePath(root, workflowCsv!)} + ${relativeEvidencePath(root, workflowCcRoleCsv!)})`
        );
      }
      // RolesPermissions.csv (client-2 RBP format)
      const rolesPermissionsCsv = await findFile(root, file => path.basename(file).toLowerCase() === 'rolespermissions.csv');
      if (rolesPermissionsCsv) {
        evidence.push(`RolesPermissions.csv found at ${relativeEvidencePath(root, rolesPermissionsCsv)} (client-2 RBP format)`);
      }
      // businessrulesassignments.csv
      const businessRulesAssignmentsCsv = await findFile(
        root,
        file => path.basename(file).toLowerCase() === 'businessrulesassignments.csv'
      );
      if (businessRulesAssignmentsCsv) {
        evidence.push(
          `businessrulesassignments.csv found at ${relativeEvidencePath(root, businessRulesAssignmentsCsv)} (client-2 rules assignment)`
        );
      }
      // succession XML
      const xmlFiles = await findFiles(root, file => file.toLowerCase().endsWith('.xml'));
      for (const xml of xmlFiles) {
        try {
          const content = await fs.readFile(xml, 'utf8');
          if (content.includes('<succession-data-model')) {
            evidence.push(`Succession data model XML found: ${relativeEvidencePath(root, xml)}`);
            break;
          }
        } catch (err) {
          onIssue?.({
            code: 'detect.successionXml.readError',
            message: `Could not read XML file while probing for succession data model: ${(err as Error).message}`,
            file: path.basename(xml)
          });
        }
      }
      // RBP v2 JSON: any directory under root whose sample .json has {roleId, status, userType}
      const rbpJsonV2Dir = await findDirectoryWithRbpJsonV2Schema(root, onIssue);
      if (rbpJsonV2Dir) {
        evidence.push(
          `RBP JSON v2 schema detected in ${relativeEvidencePath(root, rbpJsonV2Dir)} (roleId/status/userType)`
        );
      }
      return { confidence: evidence.length / 4, evidence };
    }
  }
];

export interface DetectProfileOptions {
  /**
   * Receive structured diagnostics when a probe encounters a recoverable failure
   * (e.g. malformed JSON, unreadable XML). Forward to `IngestLogBuilder.add` to
   * surface diagnostics in the UI Export-Log report.
   */
  onIssue?: DetectIssueReporter;
}

export async function detectProfile(
  root: string,
  options: DetectProfileOptions = {}
): Promise<{ slug: ProfileSlug | null; displayName: string; evidence: string[] } | null> {
  if (!(await fs.pathExists(root))) return null;

  let best: { slug: ProfileSlug; displayName: string; evidence: string[]; confidence: number } | null = null;

  for (const detector of detectors) {
    const result = await detector.probe(root, options.onIssue);
    if (!best || result.confidence > best.confidence) {
      best = { slug: detector.slug, displayName: detector.displayName, ...result };
    }
  }

  if (!best || best.confidence === 0) return { slug: null, displayName: 'Unknown', evidence: [] };
  return { slug: best.slug, displayName: best.displayName, evidence: best.evidence };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try { return await fs.readdir(dir); } catch { return []; }
}

async function findSubdir(root: string, candidates: string[]): Promise<string | null> {
  const dirs = await findDirectories(root);
  for (const dir of dirs) {
    if (candidates.includes(path.basename(dir).toLowerCase())) return dir;
  }
  return null;
}

function relativeEvidencePath(root: string, fullPath: string): string {
  const relative = path.relative(root, fullPath);
  return relative || '.';
}

async function findFile(root: string, predicate: (file: string) => boolean): Promise<string | null> {
  const files = await findFiles(root, predicate);
  return files[0] ?? null;
}

async function findFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  const matches: string[] = [];
  await walkDirectoryTree(root, entry => {
    if (entry.kind === 'file' && predicate(entry.fullPath)) matches.push(entry.fullPath);
  });
  return matches;
}

async function findDirectories(root: string): Promise<string[]> {
  const matches: string[] = [];
  await walkDirectoryTree(root, entry => {
    if (entry.kind === 'dir') matches.push(entry.fullPath);
  });
  return matches;
}

async function findDirectoryWithRbpJsonV2Schema(
  root: string,
  onIssue?: DetectIssueReporter
): Promise<string | null> {
  const dirs = await findDirectories(root);
  for (const dir of dirs) {
    const jsonFiles = (await safeReaddir(dir)).filter(f => f.endsWith('.json'));
    if (jsonFiles.length === 0) continue;
    try {
      const sample = await fs.readJson(path.join(dir, jsonFiles[0]));
      if (
        sample &&
        typeof sample === 'object' &&
        'roleId' in sample &&
        'status' in sample &&
        'userType' in sample
      ) {
        return dir;
      }
    } catch (err) {
      onIssue?.({
        code: 'detect.rbpJsonV2.parseError',
        message: `Could not parse JSON sample while probing for RBP v2 schema: ${(err as Error).message}`,
        file: jsonFiles[0]
      });
    }
  }
  return null;
}

async function walkDirectoryTree(
  root: string,
  visitor: (entry: { kind: 'file' | 'dir'; fullPath: string }) => void,
  depth = 0,
  maxDepth = 3
): Promise<void> {
  if (depth > maxDepth) return;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      visitor({ kind: 'dir', fullPath });
      await walkDirectoryTree(fullPath, visitor, depth + 1, maxDepth);
      continue;
    }
    if (entry.isFile()) visitor({ kind: 'file', fullPath });
  }
}
