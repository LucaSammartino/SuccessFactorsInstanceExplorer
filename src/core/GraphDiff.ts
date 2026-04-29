/**
 * Structural diff between two dashboard exports (same shape as `data.json`).
 * Compares graph nodes and edges by stable id; node/edge bodies use deterministic serialization.
 */

export type MdfFieldDelta = {
  /** Field `name` values added on B vs A */
  added: string[];
  /** Field names removed from A vs B */
  removed: string[];
  /** Field names present in both but attribute object body changed */
  changed: string[];
};

export type DiffNodeRef = { id: string; type: string; label: string };
export type DiffNodeChange = DiffNodeRef & { changedKeys: string[]; mdfFieldDelta?: MdfFieldDelta };
export type DiffEdgeRef = { id: string; type: string };
export type DiffEdgeChange = DiffEdgeRef & { changedKeys: string[] };

export type CountsByType = Record<string, { added: number; removed: number; changed: number }>;

export interface GraphDiffResult {
  nodes: {
    added: DiffNodeRef[];
    removed: DiffNodeRef[];
    changed: DiffNodeChange[];
  };
  edges: {
    added: DiffEdgeRef[];
    removed: DiffEdgeRef[];
    changed: DiffEdgeChange[];
  };
  byNodeType: CountsByType;
  byEdgeType: CountsByType;
  /** Short human-readable lines suitable for Markdown or UI */
  summaryLines: string[];
  isEmpty: boolean;
}

export interface DashboardLike {
  graph?: {
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  };
}

/** Deterministic JSON-like string for deep equality (sorted object keys at every level). */
export function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(',')}}`;
}

function nodeRef(rec: Record<string, unknown>): DiffNodeRef {
  return {
    id: `${rec.id ?? ''}`,
    type: `${rec.type ?? 'UNKNOWN'}`,
    label: `${rec.label ?? rec.id ?? ''}`
  };
}

function edgeRef(rec: Record<string, unknown>): DiffEdgeRef {
  return {
    id: `${rec.id ?? ''}`,
    type: `${rec.type ?? 'UNKNOWN'}`
  };
}

function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of [...keys].sort()) {
    if (stableSerialize(a[k]) !== stableSerialize(b[k])) out.push(k);
  }
  return out;
}

/** Compare MDF `attributes` arrays by field name; ignores array order. */
export function diffMdfAttributes(aRaw: unknown, bRaw: unknown): MdfFieldDelta {
  const index = (v: unknown): Map<string, string> => {
    const m = new Map<string, string>();
    if (!Array.isArray(v)) return m;
    for (const it of v) {
      const rec = it as Record<string, unknown>;
      const name = `${rec?.name ?? ''}`.trim();
      if (!name) continue;
      m.set(name, stableSerialize(it));
    }
    return m;
  };
  const am = index(aRaw);
  const bm = index(bRaw);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const k of bm.keys()) {
    if (!am.has(k)) added.push(k);
    else if (am.get(k) !== bm.get(k)) changed.push(k);
  }
  for (const k of am.keys()) {
    if (!bm.has(k)) removed.push(k);
  }
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

function bump(
  map: CountsByType,
  type: string,
  field: 'added' | 'removed' | 'changed',
  delta: number
): void {
  if (!map[type]) map[type] = { added: 0, removed: 0, changed: 0 };
  map[type][field] += delta;
}

/**
 * Diff two dashboard payloads. Unknown nodes/edges without `id` are skipped.
 */
export function diffDashboardExports(aIn: DashboardLike, bIn: DashboardLike): GraphDiffResult {
  const aNodes = Array.isArray(aIn.graph?.nodes) ? aIn.graph!.nodes! : [];
  const bNodes = Array.isArray(bIn.graph?.nodes) ? bIn.graph!.nodes! : [];
  const aEdges = Array.isArray(aIn.graph?.edges) ? aIn.graph!.edges! : [];
  const bEdges = Array.isArray(bIn.graph?.edges) ? bIn.graph!.edges! : [];

  const am = new Map<string, Record<string, unknown>>();
  const bm = new Map<string, Record<string, unknown>>();
  for (const n of aNodes) {
    const id = `${n?.id ?? ''}`.trim();
    if (id) am.set(id, n);
  }
  for (const n of bNodes) {
    const id = `${n?.id ?? ''}`.trim();
    if (id) bm.set(id, n);
  }

  const added: DiffNodeRef[] = [];
  const removed: DiffNodeRef[] = [];
  const changed: DiffNodeChange[] = [];
  const byNodeType: CountsByType = {};

  for (const id of bm.keys()) {
    if (!am.has(id)) {
      const ref = nodeRef(bm.get(id)!);
      added.push(ref);
      bump(byNodeType, ref.type, 'added', 1);
    }
  }
  for (const id of am.keys()) {
    if (!bm.has(id)) {
      const ref = nodeRef(am.get(id)!);
      removed.push(ref);
      bump(byNodeType, ref.type, 'removed', 1);
    }
  }
  for (const id of am.keys()) {
    if (!bm.has(id)) continue;
    const na = am.get(id)!;
    const nb = bm.get(id)!;
    if (stableSerialize(na) === stableSerialize(nb)) continue;
    const keys = changedKeys(na, nb);
    const ref = nodeRef(nb);
    const entry: DiffNodeChange = { ...ref, changedKeys: keys };
    if (
      ref.type === 'MDF_OBJECT' &&
      (keys.includes('attributes') || keys.includes('corporateDataModel') || keys.includes('countryOverrides'))
    ) {
      if (keys.includes('attributes')) {
        entry.mdfFieldDelta = diffMdfAttributes(na.attributes, nb.attributes);
      }
    }
    changed.push(entry);
    bump(byNodeType, ref.type, 'changed', 1);
  }

  const ae = new Map<string, Record<string, unknown>>();
  const be = new Map<string, Record<string, unknown>>();
  for (const e of aEdges) {
    const id = `${e?.id ?? ''}`.trim();
    if (id) ae.set(id, e);
  }
  for (const e of bEdges) {
    const id = `${e?.id ?? ''}`.trim();
    if (id) be.set(id, e);
  }

  const eAdded: DiffEdgeRef[] = [];
  const eRemoved: DiffEdgeRef[] = [];
  const eChanged: DiffEdgeChange[] = [];
  const byEdgeType: CountsByType = {};

  for (const id of be.keys()) {
    if (!ae.has(id)) {
      const ref = edgeRef(be.get(id)!);
      eAdded.push(ref);
      bump(byEdgeType, ref.type, 'added', 1);
    }
  }
  for (const id of ae.keys()) {
    if (!be.has(id)) {
      const ref = edgeRef(ae.get(id)!);
      eRemoved.push(ref);
      bump(byEdgeType, ref.type, 'removed', 1);
    }
  }
  for (const id of ae.keys()) {
    if (!be.has(id)) continue;
    const ea = ae.get(id)!;
    const eb = be.get(id)!;
    if (stableSerialize(ea) === stableSerialize(eb)) continue;
    const keys = changedKeys(ea, eb);
    const ref = edgeRef(eb);
    eChanged.push({ ...ref, changedKeys: keys });
    bump(byEdgeType, ref.type, 'changed', 1);
  }

  added.sort((x, y) => x.id.localeCompare(y.id));
  removed.sort((x, y) => x.id.localeCompare(y.id));
  changed.sort((x, y) => x.id.localeCompare(y.id));
  eAdded.sort((x, y) => x.id.localeCompare(y.id));
  eRemoved.sort((x, y) => x.id.localeCompare(y.id));
  eChanged.sort((x, y) => x.id.localeCompare(y.id));

  const summaryLines: string[] = [];
  const na = added.length,
    nr = removed.length,
    nc = changed.length;
  const ea = eAdded.length,
    er = eRemoved.length,
    ec = eChanged.length;
  summaryLines.push(`Nodes: +${na} / −${nr} / ~${nc}`);
  summaryLines.push(`Edges: +${ea} / −${er} / ~${ec}`);

  const isEmpty = na === 0 && nr === 0 && nc === 0 && ea === 0 && er === 0 && ec === 0;

  return {
    nodes: { added, removed, changed },
    edges: { added: eAdded, removed: eRemoved, changed: eChanged },
    byNodeType,
    byEdgeType,
    summaryLines,
    isEmpty
  };
}

/** Markdown report for CLI / handoff */
export function formatDiffMarkdown(
  result: GraphDiffResult,
  options: { title?: string; fromLabel?: string; toLabel?: string } = {}
): string {
  const title = options.title ?? 'Graph diff';
  const from = options.fromLabel ?? 'A';
  const to = options.toLabel ?? 'B';
  const lines: string[] = [`# ${title}`, '', `- From: ${from}`, `- To: ${to}`, '', ...result.summaryLines.map(s => `- ${s}`), ''];

  if (result.isEmpty) {
    lines.push('No structural changes detected.', '');
    return lines.join('\n');
  }

  lines.push('## Nodes added', '');
  result.nodes.added.length
    ? result.nodes.added.forEach(n => lines.push(`- \`${n.id}\` (${n.type}) — ${n.label}`))
    : lines.push('- _None_');
  lines.push('', '## Nodes removed', '');
  result.nodes.removed.length
    ? result.nodes.removed.forEach(n => lines.push(`- \`${n.id}\` (${n.type}) — ${n.label}`))
    : lines.push('- _None_');
  lines.push('', '## Nodes changed', '');
  result.nodes.changed.length
    ? result.nodes.changed.forEach(n => {
        let extra = '';
        if (n.mdfFieldDelta) {
          const d = n.mdfFieldDelta;
          const parts: string[] = [];
          if (d.added.length) parts.push(`+fields: ${d.added.join(', ')}`);
          if (d.removed.length) parts.push(`−fields: ${d.removed.join(', ')}`);
          if (d.changed.length) parts.push(`~fields: ${d.changed.join(', ')}`);
          if (parts.length) extra = ` | ${parts.join(' | ')}`;
        }
        lines.push(`- \`${n.id}\` (${n.type}) — keys: ${n.changedKeys.join(', ')}${extra}`);
      })
    : lines.push('- _None_');
  lines.push('', '## Edges added', '');
  result.edges.added.length
    ? result.edges.added.forEach(e => lines.push(`- \`${e.id}\` (${e.type})`))
    : lines.push('- _None_');
  lines.push('', '## Edges removed', '');
  result.edges.removed.length
    ? result.edges.removed.forEach(e => lines.push(`- \`${e.id}\` (${e.type})`))
    : lines.push('- _None_');
  lines.push('', '## Edges changed', '');
  result.edges.changed.length
    ? result.edges.changed.forEach(e => lines.push(`- \`${e.id}\` (${e.type}) — keys: ${e.changedKeys.join(', ')}`))
    : lines.push('- _None_');
  lines.push('');
  return lines.join('\n');
}
