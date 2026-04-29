import { appState as S, patchAppState } from './store';
import { populateAnalytics, prepareData } from './data-prepare';
import { clearGraphFocus } from './node-selection';
import type { AnyDashboard, ProjectMeta } from './types';

/** Supersede in-flight loads so an older response cannot overwrite state after rapid project switches. */
let projectLoadSeq = 0;
let projectLoadAbort: AbortController | null = null;

function projectLoadSuperseded(seq: number): boolean {
    return seq !== projectLoadSeq;
}

/** Drop selections and overlays that reference node IDs from the previous dashboard. */
export function resetExplorationStateForProjectSwitch() {
    S.workflowHeatActive = false;
    S.blastRadiusActive = false;
    S.blastRadiusSourceId = null;
    S.blastRadiusNodeIds = new Set();
    S.pathFindStart = null;
    S.pathFindEnd = null;
    S.pathFindNodes = [];
    S.simulation?.stop();
    S.simulation = null;
    clearGraphFocus();
    S.currentSelection = null;
    S.focusRequestId = null;
    S.currentWorkflowCode = null;
    S.currentWorkflowCodeRight = null;
    S.currentWorkflowQueryRight = '';
    S.exploreLeftSelection = null;
    S.exploreRightSelection = null;
    S.pendingGatewayViewport = null;
    S.pinnedPositions = new Map();
    S.matrixSelectedRoleIds = [];
    S.matrixSelectedObjectIds = [];
    S.matrixSelectedPermissionKeys = [];
    S.matrixSelectedFieldKeys = [];
}

/** If the module/submodule pickers still reference families missing in `S.allNodes`, fall back to ALL. */
export function clampModuleFiltersToLoadedGraph() {
    if (S.currentModule === 'ALL') {
        S.currentSubModule = 'ALL';
        return;
    }
    const hasModule = S.allNodes.some(n => n.moduleFamily === S.currentModule);
    if (!hasModule) {
        S.currentModule = 'ALL';
        S.currentSubModule = 'ALL';
        return;
    }
    if (S.currentSubModule === 'ALL') return;
    const hasSub = S.allNodes.some(
        n => n.moduleFamily === S.currentModule && n.subModule === S.currentSubModule
    );
    if (!hasSub) S.currentSubModule = 'ALL';
}

/** Minimal dashboard for a brand-new project (before first ingest) — matches shapes read by `dashboard-view-model` and `module-bars`. */
export function createEmptyDashboard(): AnyDashboard {
    return {
        generatedAt: new Date().toISOString(),
        graph: { nodes: [], edges: [] },
        permissions: { roleObjectPermissions: [], roleSystemPermissions: [] },
        stats: {
            instanceOverview: {
                mdfObjects: 0,
                businessRules: 0,
                rbpRoles: 0,
                odataEntities: 0,
                totalRelationships: 0
            },
            moduleBreakdown: {
                families: [],
                subModulesByFamily: {},
                moduleGroups: [],
                classifiedNodeCount: 0,
                unclassifiedNodeCount: 0
            },
            apiExposure: {
                coveragePct: 0,
                crud: { creatable: 0, updatable: 0, deletable: 0 }
            },
            ruleCoverage: {
                coveragePct: 0,
                ruleHotspots: []
            },
            associationAnalysis: {
                totalAssociations: 0,
                orphanCount: 0,
                dependencyHubs: []
            },
            objectTaxonomy: {
                byClass: {},
                byTechnology: {},
                topCountryOverrideObjects: []
            }
        }
    };
}

/** Apply an in-memory dashboard without fetching (e.g. newly created project before first ingest). */
export function primeClientWithDashboard(dashboard: AnyDashboard) {
    patchAppState({
        dashboard,
        splitCompareMode: false,
        splitCompareLayoutHidden: false,
        compareTargetPrepared: null,
        compareTargetProjectId: null,
        compareTargetProjectName: null,
        compareTargetViewKind: 'suite',
        compareTargetModule: 'ALL',
        compareTargetSubModule: 'ALL',
        compareTargetView: 'all',
        compareTargetObjectClass: 'ALL_OBJECTS',
        compareTargetIncludeRolePermissionLinks: false,
        compareTargetShowIsolated: false,
        compareTargetGraphFocusNodeId: null,
        graphFocusAfterRenderHost: null,
        currentWorkflowQueryRight: '',
        currentWorkflowCodeRight: null,
        exploreLeftSelection: null,
        exploreRightSelection: null,
    });
    prepareData(dashboard);
    clampModuleFiltersToLoadedGraph();
    populateAnalytics(dashboard);
}

export async function detectServer(): Promise<boolean> {
    try {
        const res = await fetch('/api/projects', { method: 'GET', signal: AbortSignal.timeout(800) });
        return res.ok;
    } catch {
        return false;
    }
}

export async function fetchProjects(): Promise<ProjectMeta[]> {
    try {
        const res = await fetch('/api/projects');
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

export async function loadProject(projectId: string | null, projectName: string | null | undefined): Promise<boolean> {
    if (!projectId) return false;
    projectLoadAbort?.abort();
    const ac = new AbortController();
    projectLoadAbort = ac;
    const seq = ++projectLoadSeq;
    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/data`, { signal: ac.signal });
        if (projectLoadSuperseded(seq)) return false;
        if (!res.ok) {
            console.warn(`[Project] No data for project ${projectId}`);
            return false;
        }
        const dashboard = (await res.json()) as AnyDashboard;
        if (projectLoadSuperseded(seq)) return false;
        const bundle = dashboard.projectBundle as { projectId?: string } | undefined;
        if (bundle?.projectId && bundle.projectId !== projectId) {
            console.warn('[Project] data.json projectBundle.projectId mismatch', bundle.projectId, projectId);
            alert(
                'This data bundle was saved for a different project id. It was not loaded. Re-run Import for this project or restore data.json from backup.'
            );
            return false;
        }
        const refreshedProjects = await fetchProjects();
        if (projectLoadSuperseded(seq)) return false;
        const activeProject = refreshedProjects.find(project => project.id === projectId)
            ?? S.allProjects.find(project => project.id === projectId);
        resetExplorationStateForProjectSwitch();
        patchAppState({
            dashboard,
            activeProjectId: projectId,
            activeProjectName: projectName ?? activeProject?.name ?? null,
            allProjects: refreshedProjects,
            splitCompareMode: false,
            splitCompareLayoutHidden: false,
            compareTargetPrepared: null,
            compareTargetProjectId: null,
            compareTargetProjectName: null,
            compareTargetViewKind: 'suite',
            compareTargetModule: 'ALL',
            compareTargetSubModule: 'ALL',
            compareTargetView: 'all',
            compareTargetObjectClass: 'ALL_OBJECTS',
            compareTargetIncludeRolePermissionLinks: false,
            compareTargetShowIsolated: false,
            compareTargetGraphFocusNodeId: null,
            graphFocusAfterRenderHost: null,
            currentWorkflowQueryRight: '',
            currentWorkflowCodeRight: null,
            exploreLeftSelection: null,
            exploreRightSelection: null,
        });
        localStorage.setItem('sf_active_project', projectId);
        prepareData(dashboard);
        clampModuleFiltersToLoadedGraph();
        populateAnalytics(dashboard);
        updateProjectBadge();
        return true;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        console.error('[Project] Failed to load project data:', err);
        return false;
    }
}

export async function patchProjectName(projectId: string, name: string): Promise<ProjectMeta | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text.slice(0, 200) || res.statusText);
    }
    return (await res.json()) as ProjectMeta;
}

export function updateProjectBadge(): void {
    const el = document.getElementById('import-active-project-name');
    if (el) el.textContent = S.activeProjectName || 'None selected';

    const shellbar = document.getElementById('app-shellbar');
    if (shellbar) {
        shellbar.setAttribute(
            'secondary-title',
            S.activeProjectName ? String(S.activeProjectName) : 'Metadata Intelligence'
        );
    }
}
