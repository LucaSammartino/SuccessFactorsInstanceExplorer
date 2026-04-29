import type { AnyDashboard } from './types';

/** Snapshot for the React overview dashboard — derived only from `AnyDashboard`. */
export type DashboardViewModel = {
    hasData: boolean;
    projectLabel: string | null;
    instance: {
        mdfObjects: number;
        businessRules: number;
        rbpRoles: number;
        odataEntities: number;
        totalRelationships: number;
        classifiedNodes: number;
        unclassifiedNodes: number;
    };
    taxonomy: {
        foundation: number;
        generic: number;
        mdf: number;
        legacy: number;
    };
    apiExposure: {
        coveragePct: number;
        creatable: number;
        updatable: number;
        deletable: number;
    };
    ruleCoverage: {
        coveragePct: number;
        hotspots: Array<{ id: string; label: string; ruleCount: number }>;
    };
    association: {
        totalAssociations: number;
        orphanCount: number;
        unresolvedAliases: number;
        hubs: Array<{ id: string; label: string; connectionCount: number }>;
    };
    taxonomyHotspots: Array<{ id: string; label: string; countryCount: number }>;
    moduleFamilies: Array<{
        family: string;
        nodeCount: number;
        objectCount: number;
        ruleCount: number;
        roleCount: number;
        subPreview: Array<{ subModule: string; nodeCount: number }>;
    }>;
};

let stableVmCache: {
    data: AnyDashboard | null;
    projectLabel: string | null;
    model: DashboardViewModel | null;
} | null = null;

/**
 * Cached view model for `useSyncExternalStore` — must return the same object reference
 * when inputs are unchanged, or React will throw (max update depth / error #185).
 */
export function getStableDashboardViewModel(
    data: AnyDashboard | null,
    projectLabel: string | null
): DashboardViewModel | null {
    if (
        stableVmCache &&
        stableVmCache.data === data &&
        stableVmCache.projectLabel === projectLabel
    ) {
        return stableVmCache.model;
    }
    const model = buildDashboardViewModel(data, projectLabel);
    stableVmCache = { data, projectLabel, model };
    return model;
}

export function buildDashboardViewModel(
    data: AnyDashboard | null,
    projectLabel: string | null
): DashboardViewModel | null {
    if (!data?.stats) return null;

    const overview = data.stats.instanceOverview;
    const mb = data.stats.moduleBreakdown;
    const api = data.stats.apiExposure;
    const rule = data.stats.ruleCoverage;
    const assoc = data.stats.associationAnalysis;
    const tax = data.stats.objectTaxonomy;
    const byClass = tax.byClass || {};
    const byTech = tax.byTechnology || {};

    const families = (mb.families || []).map((m: any) => {
        const subs = (mb.subModulesByFamily?.[m.family] || []).slice(0, 6) as Array<{ subModule: string; nodeCount: number }>;
        return {
            family: String(m.family),
            nodeCount: Number(m.nodeCount) || 0,
            objectCount: Number(m.objectCount) || 0,
            ruleCount: Number(m.ruleCount) || 0,
            roleCount: Number(m.roleCount) || 0,
            subPreview: subs.map((sm: any) => ({
                subModule: String(sm.subModule),
                nodeCount: Number(sm.nodeCount) || 0
            }))
        };
    });

    const ruleHotspots = (rule.ruleHotspots || []).slice(0, 12).map((h: any) => ({
        id: String(h.id ?? h.label ?? ''),
        label: String(h.label ?? h.id ?? ''),
        ruleCount: Number(h.ruleCount) || 0
    }));

    const depHubs = (assoc.dependencyHubs || []).slice(0, 12).map((h: any) => ({
        id: String(h.id ?? h.label ?? ''),
        label: String(h.label ?? h.id ?? ''),
        connectionCount: Number(h.connectionCount) || 0
    }));

    const countryHotspots = (tax.topCountryOverrideObjects || []).slice(0, 12).map((h: any) => ({
        id: String(h.id ?? h.label ?? ''),
        label: String(h.label ?? h.id ?? ''),
        countryCount: Number(h.countryCount) || 0
    }));

    return {
        hasData: true,
        projectLabel,
        instance: {
            mdfObjects: Number(overview.mdfObjects) || 0,
            businessRules: Number(overview.businessRules) || 0,
            rbpRoles: Number(overview.rbpRoles) || 0,
            odataEntities: Number(overview.odataEntities) || 0,
            totalRelationships: Number(overview.totalRelationships) || 0,
            classifiedNodes: Number(mb.classifiedNodeCount) || 0,
            unclassifiedNodes: Number(mb.unclassifiedNodeCount) || 0
        },
        taxonomy: {
            foundation: Number(byClass.FOUNDATION) || 0,
            generic: Number(byClass.GENERIC) || 0,
            mdf: Number(byClass.MDF) || 0,
            legacy: Number(byTech.LEGACY) || 0
        },
        apiExposure: {
            coveragePct: Number(api.coveragePct) || 0,
            creatable: Number(api.crud?.creatable) || 0,
            updatable: Number(api.crud?.updatable) || 0,
            deletable: Number(api.crud?.deletable) || 0
        },
        ruleCoverage: {
            coveragePct: Number(rule.coveragePct) || 0,
            hotspots: ruleHotspots
        },
        association: {
            totalAssociations: Number(assoc.totalAssociations) || 0,
            orphanCount: Number(assoc.orphanCount) || 0,
            unresolvedAliases: Array.isArray(data.diagnostics?.unresolvedRuleBaseObjects)
                ? data.diagnostics.unresolvedRuleBaseObjects.length
                : 0,
            hubs: depHubs
        },
        taxonomyHotspots: countryHotspots,
        moduleFamilies: families
    };
}
