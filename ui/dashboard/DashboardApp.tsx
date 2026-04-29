import { useMemo, useSyncExternalStore } from 'react';
import { appStore, appState } from '../lib/store';
import { isSplitCompareLayoutVisible } from '../lib/split-compare';
import { getStableDashboardViewModel, type DashboardViewModel } from '../lib/dashboard-view-model';
import { goToModuleFromDashboard } from '../lib/dashboard-nav';
import { selectNode } from '../lib/node-selection';
import './dashboard.css';

function subscribeStore(onChange: () => void) {
    return appStore.subscribe(() => onChange());
}

function useDashboardModelForPane(pane: 'left' | 'right'): DashboardViewModel | null {
    return useSyncExternalStore(
        subscribeStore,
        () => {
            if (pane === 'left') {
                return getStableDashboardViewModel(appState.dashboard, appState.activeProjectName);
            }
            const d = appState.compareTargetPrepared?.dashboard ?? null;
            const name = appState.compareTargetProjectName ?? appState.compareTargetProjectId;
            return getStableDashboardViewModel(d, name);
        },
        () => {
            if (pane === 'left') {
                return getStableDashboardViewModel(appState.dashboard, appState.activeProjectName);
            }
            const d = appState.compareTargetPrepared?.dashboard ?? null;
            const name = appState.compareTargetProjectName ?? appState.compareTargetProjectId;
            return getStableDashboardViewModel(d, name);
        }
    );
}

function useWorkspace(): string {
    return useSyncExternalStore(
        subscribeStore,
        () => appState.activeWorkspace,
        () => appState.activeWorkspace
    );
}

function RankedList(props: {
    title: string;
    pane: 'left' | 'right';
    items: Array<{ id: string; label: string; count: number; suffix: string }>;
}) {
    const { items, title, pane } = props;
    if (items.length === 0) {
        return <p className="db-empty" style={{ margin: 0 }}>No {title.toLowerCase()} data.</p>;
    }
    return (
        <div className="db-ranked" aria-label={title}>
            {items.map(row => (
                <button
                    key={row.id}
                    type="button"
                    className="db-ranked-item"
                    onClick={() => {
                        if (!row.id) return;
                        if (pane === 'right' && !appState.nodeById.has(row.id)) return;
                        if (appState.nodeById.has(row.id)) {
                            selectNode(row.id, { type: 'SIDEBAR', fromSearch: false });
                        }
                    }}
                >
                    <span className="db-ranked-name" title={row.label}>
                        {row.label || row.id}
                    </span>
                    <span className="db-ranked-badge">
                        {row.count} {row.suffix}
                    </span>
                </button>
            ))}
        </div>
    );
}

function DashboardInner({ model, pane }: { model: DashboardViewModel; pane: 'left' | 'right' }) {
    const ruleItems = useMemo(
        () =>
            model.ruleCoverage.hotspots.map(h => ({
                id: h.id,
                label: h.label,
                count: h.ruleCount,
                suffix: 'rules'
            })),
        [model.ruleCoverage.hotspots]
    );
    const hubItems = useMemo(
        () =>
            model.association.hubs.map(h => ({
                id: h.id,
                label: h.label,
                count: h.connectionCount,
                suffix: 'links'
            })),
        [model.association.hubs]
    );
    const taxItems = useMemo(
        () =>
            model.taxonomyHotspots.map(h => ({
                id: h.id,
                label: h.label,
                count: h.countryCount,
                suffix: 'countries'
            })),
        [model.taxonomyHotspots]
    );

    return (
        <div className="dashboard-kit-root">
            <header className="db-shell">
                <p className="db-shell-eyebrow">Analytics</p>
                <h1 className="db-shell-title">Instance overview</h1>
                <p className="db-shell-lead">
                    {model.projectLabel ? (
                        <>
                            Project <strong>{model.projectLabel}</strong> — key counts and coverage for the loaded
                            SuccessFactors metadata export.
                        </>
                    ) : (
                        <>Key counts and coverage for the loaded SuccessFactors metadata export.</>
                    )}
                </p>
            </header>

            <div className="db-kpi-row">
                <div className="db-kpi-card">
                    <span className="db-kpi-value">{model.instance.mdfObjects.toLocaleString()}</span>
                    <span className="db-kpi-label">MDF objects</span>
                </div>
                <div className="db-kpi-card">
                    <span className="db-kpi-value">{model.instance.businessRules.toLocaleString()}</span>
                    <span className="db-kpi-label">Business rules</span>
                </div>
                <div className="db-kpi-card">
                    <span className="db-kpi-value">{model.instance.rbpRoles.toLocaleString()}</span>
                    <span className="db-kpi-label">RBP roles</span>
                </div>
                <div className="db-kpi-card">
                    <span className="db-kpi-value">{model.instance.odataEntities.toLocaleString()}</span>
                    <span className="db-kpi-label">OData entities</span>
                </div>
            </div>

            <div className="db-metrics-strip">
                <span>
                    <strong>{model.instance.totalRelationships.toLocaleString()}</strong> relationships
                </span>
                <span>
                    <strong>{model.instance.classifiedNodes.toLocaleString()}</strong> classified nodes
                </span>
                <span>
                    <strong>{model.instance.unclassifiedNodes.toLocaleString()}</strong> unclassified
                </span>
            </div>

            <div className="db-panels">
                <section className="db-panel">
                    <div className="db-panel-header">
                        <h2 className="db-panel-title">Module breakdown</h2>
                    </div>
                    <div className="db-panel-body">
                        <div className="db-module-list">
                            {model.moduleFamilies.length === 0 ? (
                                <p className="db-empty" style={{ margin: 0 }}>
                                    No module families in this export.
                                </p>
                            ) : (
                                model.moduleFamilies.map(m => (
                                    <button
                                        key={m.family}
                                        type="button"
                                        className="db-module-row"
                                        onClick={() => goToModuleFromDashboard(m.family)}
                                    >
                                        <div className="db-module-main">
                                            <div className="db-module-title">{m.family}</div>
                                            <div className="db-module-stats">
                                                {m.objectCount.toLocaleString()} objects ·{' '}
                                                {m.ruleCount.toLocaleString()} rules · {m.roleCount.toLocaleString()}{' '}
                                                roles
                                            </div>
                                            {m.subPreview.length > 0 ? (
                                                <div className="db-sub-pills">
                                                    {m.subPreview.map(sm => (
                                                        <button
                                                            key={sm.subModule}
                                                            type="button"
                                                            className="db-sub-pill"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                goToModuleFromDashboard(m.family, sm.subModule);
                                                            }}
                                                            title={`${sm.nodeCount} nodes`}
                                                        >
                                                            {sm.subModule}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                        <span className="db-module-badge">{m.nodeCount.toLocaleString()}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </section>

                <div className="db-stack">
                    <section className="db-panel">
                        <div className="db-panel-header">
                            <h2 className="db-panel-title">Object taxonomy</h2>
                        </div>
                        <div className="db-panel-body">
                            <dl className="db-metric-grid">
                                <dt>Foundation</dt>
                                <dd>{model.taxonomy.foundation.toLocaleString()}</dd>
                                <dt>Generic</dt>
                                <dd>{model.taxonomy.generic.toLocaleString()}</dd>
                                <dt>MDF</dt>
                                <dd>{model.taxonomy.mdf.toLocaleString()}</dd>
                                <dt>Legacy technology</dt>
                                <dd>{model.taxonomy.legacy.toLocaleString()}</dd>
                            </dl>
                            <RankedList title="Country override hotspots" items={taxItems} pane={pane} />
                        </div>
                    </section>

                    <section className="db-panel">
                        <div className="db-panel-header">
                            <h2 className="db-panel-title">API exposure</h2>
                        </div>
                        <div className="db-panel-body">
                            <div className="db-coverage">
                                <div className="db-coverage-head">
                                    <span>OData coverage</span>
                                    <span>{model.apiExposure.coveragePct}%</span>
                                </div>
                                <div className="db-coverage-track">
                                    <div
                                        className="db-coverage-fill"
                                        style={{ width: `${Math.min(model.apiExposure.coveragePct, 100)}%` }}
                                    />
                                </div>
                            </div>
                            <dl className="db-metric-grid">
                                <dt>Creatable</dt>
                                <dd>{model.apiExposure.creatable.toLocaleString()}</dd>
                                <dt>Updatable</dt>
                                <dd>{model.apiExposure.updatable.toLocaleString()}</dd>
                                <dt>Deletable</dt>
                                <dd>{model.apiExposure.deletable.toLocaleString()}</dd>
                            </dl>
                        </div>
                    </section>

                    <section className="db-panel">
                        <div className="db-panel-header">
                            <h2 className="db-panel-title">Rule coverage</h2>
                        </div>
                        <div className="db-panel-body">
                            <div className="db-coverage">
                                <div className="db-coverage-head">
                                    <span>Objects with rules</span>
                                    <span>{model.ruleCoverage.coveragePct}%</span>
                                </div>
                                <div className="db-coverage-track">
                                    <div
                                        className="db-coverage-fill"
                                        style={{ width: `${Math.min(model.ruleCoverage.coveragePct, 100)}%` }}
                                    />
                                </div>
                            </div>
                            <RankedList title="Rule hotspots" items={ruleItems} pane={pane} />
                        </div>
                    </section>

                    <section className="db-panel">
                        <div className="db-panel-header">
                            <h2 className="db-panel-title">Dependency hubs</h2>
                        </div>
                        <div className="db-panel-body">
                            <dl className="db-metric-grid">
                                <dt>Total associations</dt>
                                <dd>{model.association.totalAssociations.toLocaleString()}</dd>
                                <dt>Orphan objects</dt>
                                <dd>{model.association.orphanCount.toLocaleString()}</dd>
                                <dt>Unresolved rule aliases</dt>
                                <dd>{model.association.unresolvedAliases.toLocaleString()}</dd>
                            </dl>
                            <RankedList title="Dependency hubs" items={hubItems} pane={pane} />
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

export function DashboardAppPane({ pane }: { pane: 'left' | 'right' }) {
    const model = useDashboardModelForPane(pane);
    const workspace = useWorkspace();

    if (workspace !== 'overview') {
        return null;
    }

    if (pane === 'right') {
        if (!isSplitCompareLayoutVisible()) {
            const hiddenSession =
                appState.splitCompareMode &&
                appState.compareTargetPrepared &&
                appState.splitCompareLayoutHidden;
            return (
                <div className="dashboard-kit-root">
                    <p className="db-empty">
                        {hiddenSession ? (
                            <>
                                Target overview is hidden. Use <strong>Show target pane</strong> in the compare strip.
                            </>
                        ) : (
                            <>
                                Use the <strong>Compare</strong> tab to load a target instance here.
                            </>
                        )}
                    </p>
                </div>
            );
        }
    }

    if (!model) {
        return (
            <div className="dashboard-kit-root">
                <p className="db-empty">
                    <strong>No project loaded.</strong> Go to <strong>Import</strong> or <strong>Projects</strong> to load
                    SuccessFactors metadata.
                </p>
            </div>
        );
    }

    return <DashboardInner model={model} pane={pane} />;
}

export function DashboardApp() {
    return <DashboardAppPane pane="left" />;
}
