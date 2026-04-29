export type {
  ProfileSlug,
  WorkflowInputs,
  RbpInputs,
  DataModelInputs,
  IngestProfile,
  ProfileDetector
} from './IngestProfile.js';
export { detectProfile } from './detect.js';
export { resolveIngestProfile } from './resolveProfile.js';
export { mergeWorkflowBundle } from './mergeWorkflowCsvs.js';
export type { WorkflowMergeDiagnostics } from './mergeWorkflowCsvs.js';
