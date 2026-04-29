// Lazy-loads elkjs bundled and computes layered positions.
// Returns a Map<nodeId, {x, y}> with centre-point coordinates.

export type ElkPositions = Map<string, { x: number; y: number }>;

export interface ElkNodeSpec {
    id: string;
    width: number;
    height: number;
    /** Force into a specific ELK layer (0 = leftmost in RIGHT direction) */
    layer?: number;
}

export interface ElkEdgeSpec {
    id: string;
    from: string;
    to: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let elkInstance: any = null;

async function getElk() {
    if (!elkInstance) {
        // Use the bundled browser build so view-level layout calls do not depend on Node-oriented entrypoints.
        const mod = await import('elkjs');
        const ELK = mod.default ?? mod;
        elkInstance = new ELK();
    }
    return elkInstance;
}

export async function computeElkLayered(
    nodes: ElkNodeSpec[],
    edges: ElkEdgeSpec[],
    direction: 'RIGHT' | 'DOWN' = 'RIGHT',
    nodeSpacing = 40,
    layerSpacing = 130,
): Promise<ElkPositions> {
    if (nodes.length === 0) return new Map();

    const elk = await getElk();

    const elkNodes = nodes.map(n => ({
        id: n.id,
        width: n.width,
        height: n.height,
        ...(n.layer !== undefined
            ? { layoutOptions: { 'elk.layered.layering.layerId': String(n.layer) } }
            : {}),
    }));

    const elkEdges = edges.map(e => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await elk.layout({
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': direction,
            'elk.spacing.nodeNode': String(nodeSpacing),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
            'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
            'elk.edgeRouting': 'SPLINES',
            'elk.layered.mergeEdges': 'false',
        },
        children: elkNodes,
        edges: elkEdges,
    });

    const positions: ElkPositions = new Map();
    for (const n of result.children ?? []) {
        positions.set(n.id as string, {
            x: (n.x ?? 0) + (n.width ?? 60) / 2,
            y: (n.y ?? 0) + (n.height ?? 40) / 2,
        });
    }
    return positions;
}
