/** Usable pixel size of the graph drawing host (`#graph-canvas`). */

export type GraphViewportSize = { width: number; height: number };

const FALLBACK_W = 1200;
const FALLBACK_H = 800;

export function readGraphViewportSize(host: HTMLElement | null): GraphViewportSize {
    let width = host?.clientWidth ?? 0;
    let height = host?.clientHeight ?? 0;
    const graphVp = host?.closest('.graph-viewport') as HTMLElement | null;
    if (graphVp && (width < 2 || height < 2)) {
        width = graphVp.clientWidth;
        height = graphVp.clientHeight;
    }
    if (width < 2 || height < 2) {
        const rect = host?.getBoundingClientRect();
        if (rect && rect.width >= 2 && rect.height >= 2) {
            width = Math.floor(rect.width);
            height = Math.floor(rect.height);
        } else {
            let el: HTMLElement | null = host?.parentElement ?? null;
            while (el && (width < 2 || height < 2)) {
                width = el.clientWidth;
                height = el.clientHeight;
                el = el.parentElement;
            }
        }
    }
    return {
        width: Math.max(1, width || FALLBACK_W),
        height: Math.max(1, height || FALLBACK_H),
    };
}
