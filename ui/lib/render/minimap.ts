// Canvas minimap — renders a thumbnail of the main SVG viewport in the corner.
// The minimap shows viewport rect that the user can click/drag to pan.

import * as d3 from 'd3';
import { getActiveGraphCanvasHostId } from '../graph-canvas-host';
import { appState as S } from '../store';

const MM_W = 128;
const MM_H = 80;

export type MinimapKind = 'primary' | 'compare';

type Slot = { canvas: HTMLCanvasElement | null; raf: number | null };

const slots: Record<MinimapKind, Slot> = {
    primary: { canvas: null, raf: null },
    compare: { canvas: null, raf: null },
};

function hostElementId(kind: MinimapKind): string {
    return kind === 'primary' ? 'graph-minimap-host' : 'graph-minimap-host-right';
}

function canvasId(kind: MinimapKind): string {
    return kind === 'primary' ? 'minimap-canvas' : 'minimap-canvas-right';
}

function graphRefs(kind: MinimapKind) {
    if (kind === 'primary') {
        return { svg: S.svg, g: S.g, zoom: S.zoomBehavior, sim: S.simulation };
    }
    return {
        svg: S.graphRightSvg,
        g: S.graphRightG,
        zoom: S.graphRightZoomBehavior,
        sim: S.graphRightSimulation,
    };
}

export function initMinimap(kind: MinimapKind = 'primary') {
    const host = document.getElementById(hostElementId(kind));
    if (!host) return;

    host.querySelector(`#${canvasId(kind)}`)?.remove();

    const canvas = document.createElement('canvas');
    canvas.id = canvasId(kind);
    canvas.className = 'graph-minimap-canvas';
    canvas.width = MM_W;
    canvas.height = MM_H;
    canvas.setAttribute('aria-label', kind === 'primary' ? 'Graph overview map (base)' : 'Graph overview map (compare)');
    host.appendChild(canvas);
    slots[kind].canvas = canvas;

    canvas.addEventListener('click', ev => handleMinimapClick(ev, kind));
    scheduleMinimapUpdate(kind);
}

export function destroyMinimap(kind: MinimapKind) {
    const slot = slots[kind];
    if (slot.raf) {
        cancelAnimationFrame(slot.raf);
        slot.raf = null;
    }
    slot.canvas?.remove();
    slot.canvas = null;
}

function scheduleMinimapUpdate(kind: MinimapKind) {
    const slot = slots[kind];
    if (slot.raf) cancelAnimationFrame(slot.raf);
    slot.raf = requestAnimationFrame(() => drawMinimap(kind));
}

function drawMinimap(kind: MinimapKind) {
    const slot = slots[kind];
    slot.raf = null;
    const { svg, g, sim } = graphRefs(kind);
    if (!slot.canvas || !g || !svg) return;

    const ctx = slot.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, MM_W, MM_H);

    const svgEl = svg.node();
    const gEl = g.node();
    if (!svgEl || !gEl) return;

    const svgW = svgEl.clientWidth || 1200;
    const svgH = svgEl.clientHeight || 800;

    const nodePositions: Array<{ x: number; y: number }> = [];
    g.selectAll('.graph-node, .suite-node, .bp-node, .rbp-node, .rl-node').each(function () {
        const el = this as SVGGElement;
        const transform = el.getAttribute('transform') ?? '';
        const m = /translate\(([^,)]+),([^)]+)\)/.exec(transform);
        if (m) nodePositions.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    });

    if (nodePositions.length === 0) return;

    const xs = nodePositions.map(p => p.x);
    const ys = nodePositions.map(p => p.y);
    const minX = Math.min(...xs) - 20,
        maxX = Math.max(...xs) + 20;
    const minY = Math.min(...ys) - 20,
        maxY = Math.max(...ys) + 20;
    const gW = maxX - minX || 1,
        gH = maxY - minY || 1;
    const scale = Math.min(MM_W / gW, MM_H / gH) * 0.9;
    const ox = (MM_W - gW * scale) / 2 - minX * scale;
    const oy = (MM_H - gH * scale) / 2 - minY * scale;

    ctx.fillStyle = 'rgba(11, 108, 242, 0.45)';
    nodePositions.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x * scale + ox, p.y * scale + oy, 2, 0, Math.PI * 2);
        ctx.fill();
    });

    const transform = d3.zoomTransform(svgEl);
    const vx = -transform.x / transform.k;
    const vy = -transform.y / transform.k;
    const vw = svgW / transform.k;
    const vh = svgH / transform.k;

    ctx.strokeStyle = 'rgba(11, 108, 242, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx * scale + ox, vy * scale + oy, vw * scale, vh * scale);

    if (sim && sim.alpha() > 0.01) {
        scheduleMinimapUpdate(kind);
    }
}

function handleMinimapClick(ev: MouseEvent, kind: MinimapKind) {
    const slot = slots[kind];
    const { svg, g, zoom } = graphRefs(kind);
    if (!slot.canvas || !svg || !zoom || !g) return;
    const svgEl = svg.node()!;
    const svgW = svgEl.clientWidth || 1200;
    const svgH = svgEl.clientHeight || 800;

    const nodePositions: Array<{ x: number; y: number }> = [];
    g.selectAll('.graph-node, .suite-node, .bp-node, .rbp-node, .rl-node').each(function () {
        const el = this as SVGGElement;
        const transform = el.getAttribute('transform') ?? '';
        const m = /translate\(([^,)]+),([^)]+)\)/.exec(transform);
        if (m) nodePositions.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    });
    if (nodePositions.length === 0) return;

    const xs = nodePositions.map(p => p.x);
    const ys = nodePositions.map(p => p.y);
    const minX = Math.min(...xs) - 20,
        maxX = Math.max(...xs) + 20;
    const minY = Math.min(...ys) - 20,
        maxY = Math.max(...ys) + 20;
    const gW = maxX - minX || 1,
        gH = maxY - minY || 1;
    const scale = Math.min(MM_W / gW, MM_H / gH) * 0.9;
    const ox = (MM_W - gW * scale) / 2 - minX * scale;
    const oy = (MM_H - gH * scale) / 2 - minY * scale;

    const rect = slot.canvas.getBoundingClientRect();
    const mmX = ev.clientX - rect.left;
    const mmY = ev.clientY - rect.top;
    const gx = (mmX - ox) / scale;
    const gy = (mmY - oy) / scale;

    const currentTransform = d3.zoomTransform(svgEl);
    const newTransform = d3.zoomIdentity
        .translate(svgW / 2 - gx * currentTransform.k, svgH / 2 - gy * currentTransform.k)
        .scale(currentTransform.k);

    svg.transition().duration(300).call(zoom.transform as any, newTransform);
}

/** Call after simulation ticks or layout changes to refresh the minimap. */
export function refreshMinimap(kind: MinimapKind) {
    if (slots[kind].canvas) scheduleMinimapUpdate(kind);
}

/** Use during suite / blueprint / RBP renders that already know the active host. */
export function refreshMinimapForActiveCanvas() {
    refreshMinimap(getActiveGraphCanvasHostId() === 'graph-canvas-right' ? 'compare' : 'primary');
}
