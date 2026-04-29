/** Graph entity fills — aligned with CSS entity tokens; architecture anchors stay mid-tone (not near-black). */
export const NODE_COLORS: Record<string, string> = {
    MDF_OBJECT: '#0b6cf2',
    BUSINESS_RULE: '#d97706',
    RBP_ROLE: '#be3b2b',
    ODATA_ENTITY: '#0c8cab',
    GATEWAY_NODE: '#8f9dae',
    // Synthetic architecture nodes
    ARCH_ANCHOR: '#475569',
    MODULE_CLUSTER: '#6366f1',
    SUBMODULE_CLUSTER: '#818cf8',
    API_FACADE: '#0891b2',
};

/** Force-layout (Drilldown) node circle fill — keep in sync with `attachNodes` in graph-render. */
export function drilldownNodeCircleFill(d: { type?: string; gatewayType?: string; isExpanded?: boolean }): string {
    if (d.type !== 'GATEWAY_NODE') return NODE_COLORS[d.type as string] || '#7b8798';
    const base = NODE_COLORS[d.gatewayType as string] || '#8f9dae';
    return d.isExpanded ? base : `${base}33`;
}

export const MODULE_CLUSTER_COLORS: Record<string, string> = {
    EC: '#0b6cf2',
    ECP: '#2563eb',
    RCM: '#7c3aed',
    ONB: '#9333ea',
    'PM/GM': '#16a34a',
    SD: '#15803d',
    LMS: '#059669',
    COMP: '#d97706',
    JPB: '#b45309',
    PLT: '#475569',
    STE: '#64748b',
    TIH: '#0891b2',
    WFA: '#0e7490',
    Unclassified: '#94a3b8',
};

export const EDGE_STYLES: Record<string, { color: string; width: number; dash: string | null }> = {
    ASSOCIATION: { color: '#a5b4c7', width: 1.2, dash: null },
    TRIGGERED_BY: { color: '#d97706', width: 1.35, dash: '3 3' },
    MODIFIES: { color: '#f59e0b', width: 1.45, dash: null },
    EXPOSES: { color: '#0c8cab', width: 1.35, dash: '4 2' },
    PERMITS: { color: '#be3b2b', width: 1.25, dash: '5 3' },
    GATEWAY: { color: '#8f9dae', width: 1.2, dash: '6 3' },
    // Synthetic architecture edges
    BACKBONE_SUPPORTS: { color: '#334155', width: 2.0, dash: null },
    EXTENDS: { color: '#6366f1', width: 1.5, dash: '5 2' },
    SECURES: { color: '#be3b2b', width: 1.5, dash: '4 2' },
    EXPOSES_API: { color: '#0891b2', width: 1.5, dash: '4 2' },
};

// Rule event type color hints
export const RULE_EVENT_COLORS: Record<string, string> = {
    onSave: '#d97706',
    onInit: '#f59e0b',
    onChange: '#fbbf24',
    onView: '#fde68a',
    onImport: '#92400e',
    default: '#d97706',
};

// Association kind sub-styles (overlay on top of ASSOCIATION base)
export const ASSOC_KIND_DASH: Record<string, string | null> = {
    COMPOSITE: null,       // solid
    VALID_WHEN: '2 4',     // loose dots
    ONE_TO_MANY: null,
};

export const ASSOC_KIND_WIDTH: Record<string, number> = {
    COMPOSITE: 2.2,
    VALID_WHEN: 0.9,
    ONE_TO_MANY: 1.2,
};

export const WORKFLOW_SIDEBAR_LIMIT = 500;
export const ROLES_OVERVIEW_LIMIT = 15;
export const GATEWAY_THRESHOLD = 2;

// Drilldown-specific gateway thresholds (raised from GATEWAY_THRESHOLD)
export const GATEWAY_RULES_THRESHOLD = 4;
export const GATEWAY_ROLES_THRESHOLD = 6;
export const GATEWAY_OBJECTS_THRESHOLD = 8;
