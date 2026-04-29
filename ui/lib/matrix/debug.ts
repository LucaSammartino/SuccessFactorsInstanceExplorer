/**
 * Permission matrix diagnostics (session export, console, agent hook) are opt-in via
 * `?matrix-debug=1` on the page URL. Reload after toggling.
 */

export function isPermMatrixDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return new URLSearchParams(window.location.search).get('matrix-debug') === '1';
    } catch {
        return false;
    }
}
