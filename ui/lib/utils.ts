import { appState as S } from './store';
import { selectNode } from './node-selection';

export function setText(id: string, value: any) {
    const element = document.getElementById(id);
    if (element) element.innerText = String(value);
}

export function setBar(id: string, percentage: number) {
    const element = document.getElementById(id);
    if (element) element.style.width = `${Math.min(percentage, 100)}%`;
}

export function formatType(type: any): string {
    const map: Record<string, string> = {
        MDF_OBJECT: 'Object',
        BUSINESS_RULE: 'Business Rule',
        RBP_ROLE: 'RBP Role',
        ODATA_ENTITY: 'OData Entity'
    };
    return map[String(type)] || String(type);
}

export function formatViewLabel(view: any): string {
    return view === 'all' ? 'All Types' : formatType(view);
}

export function formatObjectClassLabel(value: any): string {
    const map: Record<string, string> = {
        ALL_OBJECTS: 'All Objects',
        FOUNDATION: 'Foundation',
        MDF: 'MDF',
        GENERIC: 'Generic'
    };
    return map[String(value)] || String(value);
}

export function formatBoolean(value: any): string {
    if (value === true || value === 'true') return 'Yes';
    if (value === false || value === 'false') return 'No';
    return 'Unknown';
}

export function pushToMapArray(map: Map<any, any[]>, key: any, value: any) {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(value);
}

export function buildGroupedMap(items: any[], keySelector: (item: any) => any) {
    const map = new Map<any, any[]>();
    items.forEach((item: any) => pushToMapArray(map, keySelector(item), item));
    return map;
}

export function escapeHtml(value: any): string {
    return `${value ?? ''}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function escapeAttribute(value: any): string {
    return escapeHtml(value);
}

export function truncateLabel(value: any, maxLength: number): string {
    const text = `${value || ''}`.trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function trustedHtml(html: string): { __trustedHtml: string } {
    return { __trustedHtml: html };
}

export function populateRankedList(containerId: string, items: any[], countKey: string, suffix: string) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = items.map(item => `
        <div class="ranked-item" data-node-id="${escapeAttribute(item.id)}">
            <span class="ranked-name">${escapeHtml(item.label || item.id)}</span>
            <span class="ranked-badge">${item[countKey]} ${escapeHtml(suffix)}</span>
        </div>
    `).join('');

    container.querySelectorAll('[data-node-id]').forEach(item => {
        item.addEventListener('click', () => {
            const nodeId = item.getAttribute('data-node-id');
            if (nodeId && S.nodeById.has(nodeId)) selectNode(nodeId, { type: 'SIDEBAR', fromSearch: false });
        });
    });
}

export function buildWorkflowListFlags(workflow: any) {
    const flags: string[] = [];
    if (workflow.hasDynamicAssignment) flags.push('Dynamic');
    if (workflow.delegateSupported) flags.push('Delegate');
    if (workflow.hasCcActors) flags.push('CC');
    if (workflow.hasContributors) flags.push('Contributors');
    if (workflow.respectRbp) flags.push('RBP');
    if (workflow.futureDatedAlternateWorkflow) flags.push('Future alt');
    if (workflow.ccLinkToApprovalPage) flags.push('CC link');
    return flags.slice(0, 7);
}

export function formatWorkflowRoleHint(workflow: any) {
    const roles = workflow.approverRoles || [];
    if (!roles.length) return '';
    const shown = roles.slice(0, 2).join(', ');
    const extra = roles.length > 2 ? ` +${roles.length - 2}` : '';
    return `Roles: ${shown}${extra}`;
}

export function formatWorkflowBaseObjectsLine(workflow: any) {
    const types = workflow.baseObjectTypes || [];
    if (!types.length) return '';
    const max = 3;
    const shown = types.slice(0, max).join(', ');
    const extra = types.length > max ? ` +${types.length - max}` : '';
    return `Base objects: ${shown}${extra}`;
}

export function buildWorkflowActionSkipLine(workflow: any) {
    const actions = workflow.actionTypes || [];
    const skips = workflow.skipTypes || [];
    if (!actions.length && !skips.length) return '';
    const a = actions.length ? `Actions: ${actions.slice(0, 3).join(', ')}${actions.length > 3 ? '…' : ''}` : '';
    const s = skips.length ? `Skips: ${skips.slice(0, 2).join(', ')}${skips.length > 2 ? '…' : ''}` : '';
    return [a, s].filter(Boolean).join(' · ');
}

export class FetchError extends Error {
    readonly status: number;
    readonly body: string;
    constructor(message: string, status: number, body: string) {
        super(message);
        this.name = 'FetchError';
        this.status = status;
        this.body = body;
    }
}

/**
 * Fetch JSON with response.ok checked up-front. Throws `FetchError` on non-2xx
 * (carrying status + body for callers that want to surface server messages),
 * or rethrows the underlying error on network/JSON failures.
 */
export async function fetchJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new FetchError(
            `Request failed: ${response.status} ${response.statusText}`,
            response.status,
            body
        );
    }
    return (await response.json()) as T;
}
