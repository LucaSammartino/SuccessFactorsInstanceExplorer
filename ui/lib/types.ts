/* eslint-disable @typescript-eslint/no-explicit-any */

export type CascadingNode = { id: string; type: string; [key: string]: unknown };

export type CascadingEdge = {
    id?: string;
    from: string;
    to: string;
    type: string;
    ruleBindingType?: string;
    associationKind?: string;
    [key: string]: any;
};

export type ConnectedComponent = {
    id: string;
    nodeIds: string[];
    edgeIds: string[];
    edgeCount: number;
};

export type SimGraphNode = CascadingNode & {
    x?: number; y?: number; vx?: number; vy?: number;
    fx?: number | null; fy?: number | null;
};

export type ViewKind = 'suite' | 'blueprint' | 'drilldown' | 'rbp-flow';
export type LayoutPreset = 'static' | 'elk-layered' | 'd3-force';
export type PinnedPosition = { x: number; y: number };
export type PinsByScope = Map<string, Map<string, PinnedPosition>>;

export type VisibleStatBucket = {
    degree: number;
    weightedDegree: number;
    MDF_OBJECT: number;
    BUSINESS_RULE: number;
    RBP_ROLE: number;
    ODATA_ENTITY: number;
    associationCount: number;
    ruleCount: number;
    permissionCount: number;
    exposureCount: number;
};

export type AnyNode = CascadingNode;
export type AnyEdge = CascadingEdge;
export type AnyDashboard = Record<string, any>;

export type SearchEntry = {
    index: number;
    kind: string;
    nodeId: string;
    label: string;
    subtitle: string;
    searchText: string;
    fieldName?: string;
    permissionName?: string;
};

export type WorkflowEntry = Record<string, any>;
export type RoleObjPerm = Record<string, any>;
export type RoleSysPerm = Record<string, any>;

export type GraphData = {
    scopeLabel: string;
    viewKind?: ViewKind;
    scopeKey?: string;
    layoutPreset?: LayoutPreset;
    nodes: AnyNode[];
    edges: AnyEdge[];
    visibleDegree: Map<string, number>;
    visibleStats: Map<string, VisibleStatBucket>;
    objectNodeCount: number;
    componentByNodeId: Map<string, string>;
    components: ConnectedComponent[];
    hiddenComponentCount: number;
    hiddenLowSignalNodeCount: number;
};

export type SelectionState = {
    nodeId: string;
    type: string;
    fieldName?: string;
    permissionName?: string;
    fromSearch?: boolean;
} | null;

export type ProjectMeta = {
    id: string;
    name?: string;
    createdAt?: string;
    lastProcessed?: string | null;
    stats?: Record<string, number>;
};

export type ApplySearchOptions = {
    appendFocus?: boolean;
    fromGraphFinder?: boolean;
};

export type DetailProjectContext = {
    sourcePane?: 'left' | 'right';
    detailProjectLabel?: string | null;
};

export type SelectNodeContext = {
    type?: string;
    fieldName?: string;
    permissionName?: string;
    fromSearch?: boolean;
    promoteModule?: boolean;
    focusGraph?: boolean;
} & DetailProjectContext;
/* eslint-enable @typescript-eslint/no-explicit-any */
