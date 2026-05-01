import * as d3 from 'd3';
import type { PreparedInstanceModel } from './prepared-instance';
import type {
    AnyDashboard, AnyNode, AnyEdge, RoleObjPerm, RoleSysPerm,
    SearchEntry, WorkflowEntry, SelectionState, GraphData, ProjectMeta,
    ViewKind, PinsByScope,
} from './types';

export type AppState = {
    dashboard: AnyDashboard | null;
    allNodes: AnyNode[];
    allEdges: AnyEdge[];
    roleObjectPermissions: RoleObjPerm[];
    roleSystemPermissions: RoleSysPerm[];
    nodeById: Map<string, AnyNode>;
    edgesByNode: Map<string, AnyEdge[]>;
    roleObjectByRole: Map<string, RoleObjPerm[]>;
    roleObjectByObject: Map<string, RoleObjPerm[]>;
    roleSystemByRole: Map<string, RoleSysPerm[]>;
    searchEntries: SearchEntry[];
    workflowEntries: WorkflowEntry[];
    workflowByCode: Map<string, WorkflowEntry>;
    currentModule: string;
    currentSubModule: string;
    currentView: string;
    currentObjectClass: string;
    currentSelection: SelectionState;
    currentGraphFocusNodeId: string | null;
    currentGraphFocusNodeIds: string[];
    currentWorkflowCode: string | null;
    currentQuery: string;
    currentSearchResults: SearchEntry[];
    currentSearchFacet: string | null;
    currentGraphFinderQuery: string;
    currentGraphFinderResults: SearchEntry[];
    currentWorkflowQuery: string;
    /** Split compare: filter + selection for target workflow list. */
    currentWorkflowQueryRight: string;
    currentWorkflowCodeRight: string | null;
    includeRolePermissionLinks: boolean;
    activeWorkspace: string;
    activeExploreView: string;
    currentExploreQuery: string;
    exploreSort: string;
    exploreModuleFilter: string;
    exploreObjectClassFilter: string;
    exploreNamespaceFilter: string;
    exploreDeepSearch: boolean;
    roleRailCollapsed: boolean;
    currentRoleRailQueryBase: string;
    currentRoleRailQueryTarget: string;
    currentGraphData: GraphData | null;
    focusRequestId: string | null;
    showIsolated: boolean;
    controlsCollapsed: boolean;
    hoveredComponentId: string | null;
    graphStatusCollapsed: boolean;
    rightSidebarCollapsed: boolean;
    inspectorHasContent: boolean;
    simulation: d3.Simulation<d3.SimulationNodeDatum, undefined> | null;
    pendingGatewayViewport: { transform: d3.ZoomTransform; nodePositions?: Map<string, any>; anchorNodeId?: string } | null;
    matrixHideUnallocatedRows: boolean;
    matrixHideUnallocatedRoles: boolean;
    matrixSelectedRoleIds: string[];
    matrixSelectedObjectIds: string[];
    matrixSelectedPermissionKeys: string[];
    matrixSelectedFieldKeys: string[];
    matrixModule: string;
    matrixSubModule: string;
    svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null;
    g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown> | null;
    zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    /** Right pane graph (split compare only). */
    graphRightSvg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown> | null;
    graphRightG: d3.Selection<SVGGElement, unknown, HTMLElement, unknown> | null;
    graphRightZoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    graphRightSimulation: d3.Simulation<d3.SimulationNodeDatum, undefined> | null;
    activeProjectId: string | null;
    activeProjectName: string | null;
    allProjects: ProjectMeta[];
    importFiles: Record<string, FileList | File[]>;
    gatewayState: Map<string, boolean>;
    currentViewKind: ViewKind;
    lastNonRbpGraphView: ViewKind;
    pinnedPositions: PinsByScope;
    blastRadiusActive: boolean;
    blastRadiusSourceId: string | null;
    blastRadiusHops: number;
    blastRadiusNodeIds: Set<string>;
    workflowHeatActive: boolean;
    pathFindStart: string | null;
    pathFindEnd: string | null;
    pathFindNodes: string[];
    legendCollapsed: boolean;
    /** Side-by-side compare: armed from Compare tab; left = base (primary store), right = target model. */
    splitCompareMode: boolean;
    /** When true, target pane is hidden but compareTargetPrepared is kept (single-pane viewing without ending the session). */
    splitCompareLayoutHidden: boolean;
    /** Collapses the compare-session strip to a compact restore pill. */
    splitCompareStripCollapsed: boolean;
    compareTargetProjectId: string | null;
    compareTargetProjectName: string | null;
    compareTargetPrepared: PreparedInstanceModel | null;
    /** Target/right graph pane controls. Left pane keeps using the existing current* fields. */
    compareTargetViewKind: ViewKind;
    compareTargetModule: string;
    compareTargetSubModule: string;
    compareTargetView: string;
    compareTargetObjectClass: string;
    compareTargetIncludeRolePermissionLinks: boolean;
    compareTargetShowIsolated: boolean;
    /** After graph render, run focusNode on this pane (split compare target graph). */
    graphFocusAfterRenderHost: 'left' | 'right' | null;
    /** RBP Flow / drilldown role selection for the compare-target graph only (role id in target bundle). */
    compareTargetGraphFocusNodeId: string | null;
    /** Split compare: independent Explore selections per pane (avoid fullscreen detail). */
    exploreLeftSelection: SelectionState;
    exploreRightSelection: SelectionState;
    /** Per-pane graph finder search (split compare). */
    paneSearchQueryLeft: string;
    paneSearchQueryRight: string;
    paneSearchResultsLeft: SearchEntry[];
    paneSearchResultsRight: SearchEntry[];
    /** Independent collapse state for each pane's controls + search strip. */
    paneControlsCollapsedLeft: boolean;
    paneControlsCollapsedRight: boolean;
    /**
     * When set, destination views (drilldown, inspector, matrix, explore) render with
     * compare diff awareness — colored halos, changed-key highlights, etc. Activated
     * from the new Compare workspace when the user clicks an "Open in …" deep-link.
     * Cleared by ending the compare session or returning to plain navigation.
     */
    compareOverlay: {
        baseId: string;
        targetId: string;
        focusNodeId: string;
        /** The originating Compare workspace search row id (may equal focusNodeId, except for FIELD rows). */
        sourceRowId: string;
    } | null;
};

type StoreListener = (state: AppState) => void;

export function createInitialState(): AppState {
    return {
        dashboard: null,
        allNodes: [],
        allEdges: [],
        roleObjectPermissions: [],
        roleSystemPermissions: [],
        nodeById: new Map(),
        edgesByNode: new Map(),
        roleObjectByRole: new Map(),
        roleObjectByObject: new Map(),
        roleSystemByRole: new Map(),
        searchEntries: [],
        workflowEntries: [],
        workflowByCode: new Map(),
        currentModule: 'ALL',
        currentSubModule: 'ALL',
        currentView: 'all',
        currentObjectClass: 'ALL_OBJECTS',
        currentSelection: null,
        currentGraphFocusNodeId: null,
        currentGraphFocusNodeIds: [],
        currentWorkflowCode: null,
        currentQuery: '',
        currentSearchResults: [],
        currentSearchFacet: null,
        currentGraphFinderQuery: '',
        currentGraphFinderResults: [],
        currentWorkflowQuery: '',
        currentWorkflowQueryRight: '',
        currentWorkflowCodeRight: null,
        includeRolePermissionLinks: false,
        activeWorkspace: 'graph',
        activeExploreView: 'objects',
        currentExploreQuery: '',
        exploreSort: 'label',
        exploreModuleFilter: 'ALL',
        exploreObjectClassFilter: 'ALL',
        exploreNamespaceFilter: 'ALL',
        exploreDeepSearch: false,
        roleRailCollapsed: false,
        currentRoleRailQueryBase: '',
        currentRoleRailQueryTarget: '',
        currentGraphData: null,
        focusRequestId: null,
        showIsolated: false,
        controlsCollapsed: false,
        hoveredComponentId: null,
        graphStatusCollapsed: true,
        rightSidebarCollapsed: true,
        inspectorHasContent: false,
        simulation: null,
        pendingGatewayViewport: null,
        matrixHideUnallocatedRows: false,
        matrixHideUnallocatedRoles: false,
        matrixSelectedRoleIds: [],
        matrixSelectedObjectIds: [],
        matrixSelectedPermissionKeys: [],
        matrixSelectedFieldKeys: [],
        matrixModule: 'ALL',
        matrixSubModule: 'ALL',
        svg: null,
        g: null,
        zoomBehavior: null,
        graphRightSvg: null,
        graphRightG: null,
        graphRightZoomBehavior: null,
        graphRightSimulation: null,
        activeProjectId: null,
        activeProjectName: null,
        allProjects: [],
        importFiles: {},
        gatewayState: new Map(),
        currentViewKind: 'suite',
        lastNonRbpGraphView: 'suite',
        pinnedPositions: new Map(),
        blastRadiusActive: false,
        blastRadiusSourceId: null,
        blastRadiusHops: 2,
        blastRadiusNodeIds: new Set(),
        workflowHeatActive: false,
        pathFindStart: null,
        pathFindEnd: null,
        pathFindNodes: [],
        legendCollapsed: false,
        splitCompareMode: false,
        splitCompareLayoutHidden: false,
        splitCompareStripCollapsed: false,
        compareTargetProjectId: null,
        compareTargetProjectName: null,
        compareTargetPrepared: null,
        compareTargetViewKind: 'suite',
        compareTargetModule: 'ALL',
        compareTargetSubModule: 'ALL',
        compareTargetView: 'all',
        compareTargetObjectClass: 'ALL_OBJECTS',
        compareTargetIncludeRolePermissionLinks: false,
        compareTargetShowIsolated: false,
        graphFocusAfterRenderHost: null,
        compareTargetGraphFocusNodeId: null,
        exploreLeftSelection: null,
        exploreRightSelection: null,
        paneSearchQueryLeft: '',
        paneSearchQueryRight: '',
        paneSearchResultsLeft: [],
        paneSearchResultsRight: [],
        paneControlsCollapsedLeft: false,
        paneControlsCollapsedRight: false,
        compareOverlay: null,
    };
}

function replaceStateObject(target: AppState, next: AppState) {
    for (const key of Object.keys(target) as (keyof AppState)[]) {
        if (!(key in next)) delete (target as Record<string, unknown>)[key as string];
    }
    Object.assign(target, next);
}

export function createStore(initialState: AppState) {
    const state = initialState;
    const listeners = new Set<StoreListener>();

    const notify = () => {
        listeners.forEach(listener => listener(state));
    };

    return {
        get() {
            return state;
        },
        set(next: Partial<AppState> | ((currentState: AppState) => Partial<AppState> | void)) {
            const resolved = typeof next === 'function' ? next(state) : next;
            if (resolved) Object.assign(state, resolved);
            notify();
            return state;
        },
        replace(next: AppState) {
            replaceStateObject(state, next);
            notify();
            return state;
        },
        reset() {
            replaceStateObject(state, createInitialState());
            notify();
            return state;
        },
        subscribe(listener: StoreListener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}

export const appStore = createStore(createInitialState());
export const appState = appStore.get();

export function getState() {
    return appStore.get();
}

export function resetAppState() {
    return appStore.reset();
}

export function patchAppState(next: Partial<AppState> | ((state: AppState) => Partial<AppState> | void)) {
    return appStore.set(next);
}

export function selectState<T>(selector: (state: AppState) => T): T {
    return selector(appStore.get());
}
