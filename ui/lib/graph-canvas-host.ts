/** Which DOM host receives the next graph render (`#graph-canvas` primary, `#graph-canvas-right` split compare). */
let activeGraphCanvasHostId = 'graph-canvas';

export function getActiveGraphCanvasHostId(): string {
    return activeGraphCanvasHostId;
}

export function setActiveGraphCanvasHostId(id: string): void {
    activeGraphCanvasHostId = id;
}

export function resetGraphCanvasHostToPrimary(): void {
    activeGraphCanvasHostId = 'graph-canvas';
}
