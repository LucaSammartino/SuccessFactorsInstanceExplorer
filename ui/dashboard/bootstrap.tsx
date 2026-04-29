import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardAppPane } from './DashboardApp';

export function mountDashboardApp(): void {
    const left = document.getElementById('dashboard-root');
    if (left) {
        const root = createRoot(left);
        root.render(
            <StrictMode>
                <DashboardAppPane pane="left" />
            </StrictMode>
        );
    }
    const right = document.getElementById('dashboard-root-right');
    if (right) {
        const rootR = createRoot(right);
        rootR.render(
            <StrictMode>
                <DashboardAppPane pane="right" />
            </StrictMode>
        );
    }
}
