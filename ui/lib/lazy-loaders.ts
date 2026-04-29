const inspectorNoop = (..._args: unknown[]) => {};

export let renderPermissionMatrix = (() => {}) as typeof import('./matrix').renderPermissionMatrix;
export let showEntityDetails = inspectorNoop as typeof import('./inspector').showEntityDetails;
export let hideEntityDetails = inspectorNoop as typeof import('./inspector').hideEntityDetails;
export let showWorkflowDetails = inspectorNoop as typeof import('./inspector').showWorkflowDetails;
export let syncWorkflowSplitDetailPanels = inspectorNoop as typeof import('./inspector').syncWorkflowSplitDetailPanels;
export let bindDropZones!: typeof import('./projects').bindDropZones;
export let bindExportLogButtons!: typeof import('./projects').bindExportLogButtons;
export let handleImportSubmit!: typeof import('./projects').handleImportSubmit;
export let handleDetectProfile!: typeof import('./projects').handleDetectProfile;
export let renderImportWorkspace!: typeof import('./projects').renderImportWorkspace;
export let renderProjectsPanel!: typeof import('./projects').renderProjectsPanel;
export let showNewProjectForm!: typeof import('./projects').showNewProjectForm;
export let handleCreateProject!: typeof import('./projects').handleCreateProject;

let matrixReady = false;
let inspectorReady = false;
let projectsPanelReady = false;

export function isMatrixReady() {
    return matrixReady;
}

export function isInspectorReady() {
    return inspectorReady;
}

export async function ensureMatrixLoaded(): Promise<void> {
    if (matrixReady) return;
    const matrix = await import('./matrix');
    renderPermissionMatrix = matrix.renderPermissionMatrix;
    matrixReady = true;
}

export async function ensureInspectorLoaded(): Promise<void> {
    if (inspectorReady) return;
    const inspector = await import('./inspector');
    showEntityDetails = inspector.showEntityDetails;
    hideEntityDetails = inspector.hideEntityDetails;
    showWorkflowDetails = inspector.showWorkflowDetails;
    syncWorkflowSplitDetailPanels = inspector.syncWorkflowSplitDetailPanels;
    inspectorReady = true;
}

export async function ensureProjectsPanelLoaded(): Promise<void> {
    if (projectsPanelReady) return;
    const projects = await import('./projects');
    bindDropZones = projects.bindDropZones;
    bindExportLogButtons = projects.bindExportLogButtons;
    handleImportSubmit = projects.handleImportSubmit;
    handleDetectProfile = projects.handleDetectProfile;
    renderImportWorkspace = projects.renderImportWorkspace;
    renderProjectsPanel = projects.renderProjectsPanel;
    showNewProjectForm = projects.showNewProjectForm;
    handleCreateProject = projects.handleCreateProject;
    projectsPanelReady = true;
}

export let mountCompareWorkspace!: typeof import('./compare/index').mountCompareWorkspace;
let compareWorkspaceReady = false;

export function isCompareWorkspaceReady() {
    return compareWorkspaceReady;
}

export async function ensureCompareWorkspaceLoaded(): Promise<void> {
    if (compareWorkspaceReady) return;
    const compare = await import('./compare/index');
    mountCompareWorkspace = compare.mountCompareWorkspace;
    compareWorkspaceReady = true;
}
