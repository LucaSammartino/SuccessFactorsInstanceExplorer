import { appState as S } from './store';
import { escapeHtml, escapeAttribute } from './utils';
import {
    createEmptyDashboard,
    fetchProjects,
    loadProject,
    patchProjectName,
    primeClientWithDashboard,
    resetExplorationStateForProjectSwitch,
    updateProjectBadge,
} from './project-api';
import { refreshWorkspace, setActiveWorkspace } from './workspace';
import { INGEST_MULTIPART_FIELD_NAME_LIST } from '@pm/ingest/ingestMultipartFields';

export { detectServer, fetchProjects, loadProject, updateProjectBadge, patchProjectName } from './project-api';

const INGEST_MULTIPART_FIELD_NAMES = new Set(INGEST_MULTIPART_FIELD_NAME_LIST);

type ImportFileCollection = FileList | File[];

function appendImportFilesToFormData(formData: FormData) {
    for (const [field, files] of Object.entries(S.importFiles)) {
        if (!INGEST_MULTIPART_FIELD_NAMES.has(field)) {
            console.warn(`[import] Skipping unknown multipart field "${field}" (not accepted by server).`);
            continue;
        }
        for (const file of files) {
            formData.append(field, file);
        }
    }
}

export function bindDropZones() {
    const folderInput = document.getElementById('import-folder-input') as HTMLInputElement | null;
    folderInput?.addEventListener('change', () => {
        if (folderInput.files?.length) void applyImportFolder(folderInput.files);
    });

    document.querySelectorAll('.import-drop-zone').forEach(zone => {
        const field = (zone as HTMLElement).dataset?.field;
        const input = zone.querySelector('input[type="file"]') as HTMLInputElement | null;

        zone.addEventListener('dragover', (event: any) => {
            event.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', (event: any) => {
            event.preventDefault();
            zone.classList.remove('drag-over');
            const files = (event as DragEvent).dataTransfer!.files;
            if (files.length) applyImportFiles(field!, files, zone);
        });

        input?.addEventListener('change', () => {
            if (input.files?.length) applyImportFiles(field!, input.files, zone);
        });
    });
}

const IMPORT_FIELD_LABELS: Record<string, string> = {
    objectDefsZip: 'Object definitions',
    rbpFiles: 'Roles and permissions',
    odataXml: 'OData metadata',
    dataModelXmls: 'Data models',
    successionDm: 'Succession data model',
    workflowSplitCsvs: 'Workflows',
    rulesExportCsv: 'Business rules',
    rulesExportZip: 'Business rules',
    businessRulesAssignmentsCsv: 'Rule assignments'
};

function setFolderStatus(message: string): void {
    const status = document.getElementById('import-folder-status');
    if (status) status.textContent = message;
}

function setImportField(filesByField: Record<string, File[]>, field: string, file: File, maxCount = Infinity): boolean {
    const files = filesByField[field] || [];
    if (files.length >= maxCount) return false;
    files.push(file);
    filesByField[field] = files;
    return true;
}

async function readFileHead(file: File, byteLimit = 65536): Promise<string> {
    try {
        return await file.slice(0, byteLimit).text();
    } catch {
        return '';
    }
}

function firstLine(text: string): string {
    return (text.replace(/^\uFEFF/, '').match(/^[^\r\n]*/) || [''])[0].toLowerCase();
}

function looksLikeRbpCsv(base: string, header: string): boolean {
    return (
        base === 'rolespermissions.csv' ||
        base === 'roletoruleinformation.csv' ||
        base === 'roletopermission.csv' ||
        base === 'roletomdfpermission.csv' ||
        base === 'report_roles_report_example.csv' ||
        (header.includes('role name') && (
            header.includes('permission') ||
            header.includes('target population') ||
            header.includes('granted population')
        ))
    );
}

function looksLikeWorkflowCsv(base: string, rel: string, header: string): boolean {
    return (
        base === 'wfinfo.csv' ||
        base === 'workflow.csv' ||
        base === 'workflows.csv' ||
        rel.includes('workflow') ||
        rel.includes('wfinfo') ||
        header.includes('wfstepapprover.approvertype') ||
        header.includes('wfconfigstep.step-num')
    );
}

async function classifyFolderFiles(files: File[]): Promise<{ filesByField: Record<string, File[]>; relevantCount: number; skippedCount: number; warnings: string[] }> {
    const filesByField: Record<string, File[]> = {};
    const warnings: string[] = [];
    let relevantCount = 0;
    let skippedCount = 0;

    for (const file of files) {
        const rel = (file.webkitRelativePath || file.name).toLowerCase();
        const base = file.name.toLowerCase();
        const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
        let accepted = false;

        if (ext === '.zip') {
            if (rel.includes('rule')) {
                accepted = setImportField(filesByField, 'rulesExportZip', file, 1);
            } else {
                accepted = setImportField(filesByField, 'objectDefsZip', file, 1);
                if (!accepted) warnings.push(`Skipped extra zip: ${file.name}`);
            }
        } else if (ext === '.json') {
            accepted = setImportField(filesByField, 'rbpFiles', file, 500);
        } else if (ext === '.xml') {
            const head = (await readFileHead(file)).toLowerCase();
            if (rel.includes('odata') || rel.includes('metadata') || rel.includes('edmx') || head.includes('<edmx:') || head.includes('entityset')) {
                accepted = setImportField(filesByField, 'odataXml', file, 1);
                if (!accepted) warnings.push(`Skipped extra OData XML: ${file.name}`);
            } else if (rel.includes('succession') || rel.includes('sdm') || head.includes('<succession-data-model')) {
                accepted = setImportField(filesByField, 'successionDm', file, 20);
            } else {
                accepted = setImportField(filesByField, 'dataModelXmls', file, 40);
            }
        } else if (ext === '.csv') {
            const header = firstLine(await readFileHead(file));
            if (base === 'businessrulesassignments.csv' || rel.includes('businessrulesassignments') || rel.includes('assignment')) {
                accepted = setImportField(filesByField, 'businessRulesAssignmentsCsv', file, 1);
            } else if (base === 'rule.csv' || rel.includes('/rules/') || rel.includes('\\rules\\')) {
                accepted = setImportField(filesByField, 'rulesExportCsv', file, 1);
            } else if (looksLikeWorkflowCsv(base, rel, header)) {
                accepted = setImportField(filesByField, 'workflowSplitCsvs', file, 20);
            } else if (looksLikeRbpCsv(base, header)) {
                accepted = setImportField(filesByField, 'rbpFiles', file, 500);
            }
        }

        if (accepted) relevantCount += 1;
        else skippedCount += 1;
    }

    if (!filesByField.objectDefsZip?.length) {
        warnings.push('No Object Definitions zip was found. Processing can reuse a previous import for this project, but a new project needs that zip.');
    }

    return { filesByField, relevantCount, skippedCount, warnings };
}

function renderFolderScanSummary(skippedCount = 0, warnings: string[] = []): void {
    const summary = document.getElementById('import-folder-summary');
    const skipped = document.getElementById('import-folder-skipped');
    const warningList = document.getElementById('import-folder-warnings');
    if (!summary) return;

    const entries = Object.entries(S.importFiles)
        .filter(([, files]) => files.length > 0)
        .map(([field, files]) => {
            const label = IMPORT_FIELD_LABELS[field] || field;
            const fileNames = Array.from(files as ImportFileCollection).map(f => f.name);
            const visibleNames = fileNames.slice(0, 3).join(', ');
            const suffix = fileNames.length > 3 ? ` +${fileNames.length - 3} more` : '';
            return `<div class="import-folder-summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(visibleNames + suffix)}</strong></div>`;
        });

    if (entries.length === 0 && skippedCount === 0 && warnings.length === 0) {
        summary.innerHTML = '';
        summary.classList.add('hidden');
        if (skipped) skipped.textContent = '';
        if (warningList) {
            warningList.innerHTML = '';
            warningList.classList.add('hidden');
        }
        return;
    }

    summary.innerHTML = entries.length ? entries.join('') : '<div class="empty-mini">No supported files found in that folder.</div>';
    summary.classList.remove('hidden');

    if (skipped) {
        skipped.textContent = skippedCount > 0 ? `${skippedCount} file${skippedCount === 1 ? '' : 's'} ignored.` : '';
    }

    if (warningList) {
        warningList.innerHTML = warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
        warningList.classList.toggle('hidden', warnings.length === 0);
    }
}

export async function applyImportFolder(fileList: FileList): Promise<void> {
    const files = Array.from(fileList);
    S.importFiles = {};
    setFolderStatus('Scanning folder...');
    const { filesByField, relevantCount, skippedCount, warnings } = await classifyFolderFiles(files);
    S.importFiles = filesByField;
    setFolderStatus(relevantCount > 0 ? `Found ${relevantCount} relevant file${relevantCount === 1 ? '' : 's'}.` : 'No supported files found.');
    renderFolderScanSummary(skippedCount, warnings);
    updateImportSubmitState();
}

type IngestSection =
    | 'objectDefs'
    | 'rbp'
    | 'odata'
    | 'dataModel'
    | 'successionDm'
    | 'workflow'
    | 'rulesCatalog'
    | 'rulesAssignment';

const SECTION_TITLES: Record<IngestSection, string> = {
    objectDefs: 'Object Definitions',
    rbp: 'Roles and Permissions',
    odata: 'OData Metadata',
    dataModel: 'Corporate + Country Data Models',
    successionDm: 'Succession Data Model',
    workflow: 'Workflow Configuration',
    rulesCatalog: 'Business Rules Export',
    rulesAssignment: 'Business Rules Assignments'
};

interface IngestIssue {
    section: IngestSection;
    engine?: string;
    severity: 'info' | 'warn' | 'error';
    code: string;
    message: string;
    file?: string;
    line?: number;
    hint?: string;
    data?: Record<string, unknown>;
}

interface IngestLog {
    startedAt: string;
    finishedAt?: string;
    issues: IngestIssue[];
    filesAccepted: Record<IngestSection, string[]>;
    filesRejected: Record<IngestSection, Array<{ file: string; reason: string }>>;
}

export function bindExportLogButtons() {
    document.querySelectorAll<HTMLButtonElement>('.import-export-log').forEach(btn => {
        btn.addEventListener('click', () => downloadSectionLog(btn));
    });
}

/** Toggle every Export Log button between enabled/disabled. Called after a successful ingest. */
export function setExportLogButtonsEnabled(enabled: boolean) {
    document.querySelectorAll<HTMLButtonElement>('.import-export-log').forEach(btn => {
        btn.disabled = !enabled;
        if (enabled) btn.setAttribute('data-has-log', 'true');
        else btn.removeAttribute('data-has-log');
    });
}

async function downloadSectionLog(btn: HTMLButtonElement) {
    const section = btn.getAttribute('data-section') as IngestSection | null;
    if (!section) return;
    if (!S.activeProjectId) {
        alert('Select a project first.');
        return;
    }

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Loading…';

    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(S.activeProjectId)}/ingest-log`);
        if (!res.ok) {
            if (res.status === 404) {
                alert('No ingest log yet. Run an ingest first to populate diagnostics.');
            } else {
                alert(`Failed to load ingest log: ${res.statusText}`);
            }
            return;
        }
        const log = await res.json() as IngestLog;
        const md = renderSectionMarkdown(log, section);
        const stamp = log.finishedAt ? log.finishedAt.replace(/[:.]/g, '-') : new Date().toISOString().replace(/[:.]/g, '-');
        const projectSlug = (S.activeProjectName || 'project').replace(/[^a-zA-Z0-9_-]+/g, '-');
        const filename = `ingest-log-${section}-${projectSlug}-${stamp}.md`;
        triggerDownload(md, filename, 'text/markdown;charset=utf-8');
    } catch (err) {
        alert(`Failed to load ingest log: ${(err as Error).message}`);
    } finally {
        btn.disabled = false;
        btn.setAttribute('data-has-log', 'true');
        if (originalText) btn.textContent = originalText;
    }
}

function renderSectionMarkdown(log: IngestLog, section: IngestSection): string {
    const sectionIssues = (log.issues || []).filter(issue => issue.section === section);
    const accepted = log.filesAccepted?.[section] || [];
    const rejected = log.filesRejected?.[section] || [];
    const title = SECTION_TITLES[section];
    const lines: string[] = [];
    lines.push(`# ${title} — ingest log`);
    lines.push('');
    lines.push(`- **Project:** ${S.activeProjectName || S.activeProjectId || '(unknown)'}`);
    if (log.startedAt) lines.push(`- **Started:** ${log.startedAt}`);
    if (log.finishedAt) lines.push(`- **Finished:** ${log.finishedAt}`);
    lines.push(`- **Issues in this section:** ${sectionIssues.length}`);
    lines.push('');

    lines.push('## Files accepted');
    if (accepted.length === 0) lines.push('- _(none)_');
    else for (const file of accepted) lines.push(`- \`${file}\``);
    lines.push('');

    if (rejected.length > 0) {
        lines.push('## Files rejected');
        for (const entry of rejected) lines.push(`- \`${entry.file}\` — ${entry.reason}`);
        lines.push('');
    }

    lines.push('## Issues');
    if (sectionIssues.length === 0) {
        lines.push('_No issues reported. Either the section ran cleanly or no inputs were provided._');
    } else {
        for (const issue of sortIssues(sectionIssues)) {
            const badge = issue.severity.toUpperCase();
            const head = issue.file ? `**[${badge}] \`${issue.file}\`** — ${issue.code}` : `**[${badge}]** ${issue.code}`;
            lines.push(`- ${head}`);
            lines.push(`  - ${escapeMd(issue.message)}`);
            if (issue.engine) lines.push(`  - engine: \`${issue.engine}\``);
            if (typeof issue.line === 'number') lines.push(`  - line: ${issue.line}`);
            if (issue.hint) lines.push(`  - hint: ${escapeMd(issue.hint)}`);
            if (issue.data && Object.keys(issue.data).length > 0) {
                lines.push(`  - data: \`${JSON.stringify(issue.data)}\``);
            }
        }
    }
    lines.push('');
    lines.push('---');
    lines.push(`Generated by SuccessFactors Instance Explorer Import workspace. Section: \`${section}\`.`);
    return lines.join('\n');
}

function sortIssues(issues: IngestIssue[]): IngestIssue[] {
    const order: Record<IngestIssue['severity'], number> = { error: 0, warn: 1, info: 2 };
    return [...issues].sort((a, b) => {
        const sev = order[a.severity] - order[b.severity];
        if (sev !== 0) return sev;
        return a.code.localeCompare(b.code);
    });
}

function escapeMd(text: string): string {
    return text.replace(/\|/g, '\\|');
}

function triggerDownload(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function applyImportFiles(field: string, files: FileList, zone: Element) {
    // Special handling: 'rulesExport' virtual field auto-routes by extension
    if (field === 'rulesExport') {
        const firstFile = files[0];
        if (firstFile?.name.toLowerCase().endsWith('.zip')) {
            S.importFiles['rulesExportZip'] = files;
            delete S.importFiles['rulesExportCsv'];
        } else {
            S.importFiles['rulesExportCsv'] = files;
            delete S.importFiles['rulesExportZip'];
        }
        const label = document.getElementById('fn-rulesExport');
        if (label) label.textContent = firstFile?.name ?? '';
        zone.classList.add('has-file');
        updateImportSubmitState();
        return;
    }
    S.importFiles[field] = files;
    const label = document.getElementById(`fn-${field}`);
    if (label) {
        label.textContent = Array.from(files as Iterable<File>).map(f => f.name).join(', ');
    }
    zone.classList.add('has-file');
    updateImportSubmitState();
}

export function updateImportSubmitState() {
    const btn = document.getElementById('import-submit');
    const hint = document.getElementById('import-submit-hint');
    const hasProject = Boolean(S.activeProjectId);
    const hasObjectDefs = Boolean(S.importFiles.objectDefsZip?.length);
    const selectedCount = Object.values(S.importFiles).reduce((total, files) => total + files.length, 0);

    if (!btn) return;

    if (!hasProject) {
        (btn as any).disabled = true;
        if (hint) hint.textContent = 'Select or create a project first.';
        return;
    }

    (btn as any).disabled = false;
    if (hint) {
        if (selectedCount === 0) hint.textContent = 'Choose a folder to scan its SuccessFactors exports.';
        else if (hasObjectDefs) hint.textContent = 'Ready to process.';
        else hint.textContent = 'No Object Definitions zip found. Processing can reuse a previous import for this project.';
    }
}

export function renderImportWorkspace() {
    updateProjectBadge();
    updateImportSubmitState();
    renderFolderScanSummary();
    refreshExportLogButtonsForActiveProject();
}

/**
 * Enable Export Log buttons when the active project already has an ingest log.
 * Called when the Import workspace is rendered — covers re-entry after switching
 * projects without a fresh ingest.
 */
async function refreshExportLogButtonsForActiveProject(): Promise<void> {
    if (!S.activeProjectId) {
        setExportLogButtonsEnabled(false);
        return;
    }
    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(S.activeProjectId)}/ingest-log`, { method: 'HEAD' });
        setExportLogButtonsEnabled(res.ok);
    } catch {
        setExportLogButtonsEnabled(false);
    }
}

export async function handleImportSubmit(event: any) {
    event.preventDefault();

    if (!S.activeProjectId) {
        alert('Please select or create a project first.');
        return;
    }

    const formData = new FormData();
    appendImportFilesToFormData(formData);

    const log = document.getElementById('import-log');
    const lines = document.getElementById('import-log-lines');
    const logActions = document.getElementById('import-log-actions');
    if (log) log.classList.remove('hidden');
    if (lines) lines.innerHTML = '';
    if (logActions) logActions.classList.add('hidden');

    const btn = document.getElementById('import-submit');
    if (btn) { (btn as any).disabled = true; btn.textContent = 'Processing…'; }

    function appendLog(message: any, type = 'info') {
        if (!lines) return;
        const el = document.createElement('div');
        el.className = `import-log-line import-log-${type}`;
        el.textContent = message;
        lines.appendChild(el);
        lines.scrollTop = lines.scrollHeight;
    }

    try {
        const response = await fetch(`/api/projects/${encodeURIComponent(S.activeProjectId)}/ingest`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({})) as { error?: string; field?: string; code?: string };
            const parts = [err.error, err.field ? `field: ${err.field}` : '', err.code ? `code: ${err.code}` : ''].filter(
                Boolean
            );
            appendLog(`Error: ${parts.join(' — ') || response.statusText}`, 'error');
            if (btn) { (btn as any).disabled = false; btn.textContent = 'Process Instance'; }
            return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;
        let succeeded = false;

        while (!done) {
            const { value, done: streamDone } = await reader.read();
            done = streamDone;
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const eventBlocks = buffer.split('\n\n');
            buffer = eventBlocks.pop() || '';

            for (const block of eventBlocks) {
                const dataLine = block.split('\n').find(l => l.startsWith('data:'));
                if (!dataLine) continue;
                try {
                    const payload = JSON.parse(dataLine.slice(5).trim());
                    if (payload.type === 'progress') appendLog(`✓ ${payload.message}`, 'ok');
                    else if (payload.type === 'error') appendLog(`✗ ${payload.message}`, 'error');
                    else if (payload.type === 'done') {
                        appendLog(`✓ ${payload.message}`, 'done');
                        succeeded = true;
                    }
                } catch { /* ignore malformed */ }
            }
        }

        if (succeeded && logActions) logActions.classList.remove('hidden');
        if (succeeded) setExportLogButtonsEnabled(true);

        if (succeeded && S.activeProjectId) {
            appendLog('Loading updated data into the explorer…', 'info');
            const loaded = await loadProject(S.activeProjectId, S.activeProjectName);
            if (loaded) {
                appendLog('✓ Explorer updated. Graph and ROFP Matrix now reflect this ingest.', 'done');
                refreshWorkspace();
            } else {
                appendLog('✗ Ingest finished but data could not be loaded. Try “Load this project”.', 'error');
            }
        }
    } catch (err) {
        appendLog(`Network error: ${(err as Error).message}`, 'error');
    } finally {
        if (btn) { (btn as any).disabled = false; btn.textContent = 'Process Instance'; }
        updateImportSubmitState();
    }
}

export function renderProjectsPanel() {
    const container = document.getElementById('projects-list');
    if (!container) return;

    if (S.allProjects.length === 0) {
        container.innerHTML = '<div class="empty-mini">No projects yet. Click "New Project" to create one.</div>';
        return;
    }

        container.innerHTML = S.allProjects.map(project => {
        const isActive = project.id === S.activeProjectId;
        const stats = project.stats;
        const statLine = stats
            ? [
                  `${(stats.mdfObjects || 0)} objects`,
                  `${(stats.businessRules || 0)} rules`,
                  `${(stats.rbpRoles || 0)} roles`,
                  typeof stats.workflows === 'number' ? `${stats.workflows} workflows` : null
              ]
                  .filter(Boolean)
                  .join(' · ')
            : 'Not yet processed';
        const lastProcessed = project.lastProcessed
            ? new Date(project.lastProcessed).toLocaleString()
            : 'Never';
        return `
            <div class="project-card${isActive ? ' active' : ''}" data-project-id="${escapeAttribute(project.id)}">
                <div class="project-card-header">
                    <div class="project-card-name">${escapeHtml(project.name)}</div>
                    ${isActive ? '<span class="project-active-badge">Active</span>' : ''}
                </div>
                <div class="project-card-meta">${escapeHtml(statLine)}</div>
                <div class="project-card-meta muted">Last processed: ${escapeHtml(lastProcessed)}</div>
                <div class="project-card-actions">
                    <button type="button" class="toolbar-chip project-load-btn" data-project-id="${escapeAttribute(project.id)}" data-project-name="${escapeAttribute(project.name)}">Load</button>
                    <button type="button" class="toolbar-chip project-import-btn" data-project-id="${escapeAttribute(project.id)}" data-project-name="${escapeAttribute(project.name)}">Import files</button>
                    <button type="button" class="toolbar-chip project-rename-btn" data-project-id="${escapeAttribute(project.id)}" data-project-name="${escapeAttribute(project.name)}">Rename</button>
                    <button type="button" class="toolbar-chip danger project-delete-btn" data-project-id="${escapeAttribute(project.id)}" data-project-name="${escapeAttribute(project.name)}">Delete</button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.project-load-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-project-id');
            const name = btn.getAttribute('data-project-name');
            const loaded = await loadProject(id, name);
            if (loaded) {
                S.allProjects = await fetchProjects();
                setActiveWorkspace('graph');
            } else {
                alert('This project has no data yet. Go to Import to process files.');
            }
        });
    });

        container.querySelectorAll('.project-import-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-project-id');
            const name = btn.getAttribute('data-project-name');
            S.activeProjectId = id;
            S.activeProjectName = name;
            updateProjectBadge();
            setActiveWorkspace('import');
        });
    });

    container.querySelectorAll('.project-rename-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-project-id');
            const current = btn.getAttribute('data-project-name') || '';
            const next = window.prompt('Project name', current);
            if (next === null) return;
            const trimmed = next.trim();
            if (!trimmed || trimmed === current) return;
            try {
                await patchProjectName(id!, trimmed);
                S.allProjects = await fetchProjects();
                if (S.activeProjectId === id) {
                    S.activeProjectName = trimmed;
                    updateProjectBadge();
                }
                renderProjectsPanel();
            } catch (err) {
                alert('Rename failed: ' + (err as Error).message);
            }
        });
    });

    container.querySelectorAll('.project-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-project-id');
            const name = btn.getAttribute('data-project-name');
            if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
            try {
                await fetch(`/api/projects/${encodeURIComponent(id!)}`, { method: 'DELETE' });
                if (S.activeProjectId === id) {
                    S.activeProjectId = null;
                    S.activeProjectName = null;
                    localStorage.removeItem('sf_active_project');
                }
                S.allProjects = await fetchProjects();
                renderProjectsPanel();
            } catch (err) {
                alert('Failed to delete project: ' + (err as Error).message);
            }
        });
    });
}

export function showNewProjectForm() {
    const form = document.getElementById('new-project-form');
    if (form) {
        form.classList.remove('hidden');
        document.getElementById('new-project-name')?.focus();
    }
}

export async function handleDetectProfile() {
    if (!S.activeProjectId) {
        alert('Select a project first.');
        return;
    }

    const btn = document.getElementById('import-detect-btn');
    if (btn) { (btn as any).disabled = true; btn.textContent = 'Detecting…'; }

    try {
        const formData = new FormData();
        appendImportFilesToFormData(formData);

        const res = await fetch(`/api/projects/${encodeURIComponent(S.activeProjectId)}/ingest/detect`, {
            method: 'POST',
            body: formData
        });
        if (!res.ok) throw new Error(await res.text());
        const { slug, displayName, evidence, unknown: isUnknown } = await res.json();
        renderProfileDetectResult({ slug, displayName, evidence, isUnknown });
    } catch (err) {
        const strip = document.getElementById('import-detect-strip');
        if (strip) {
            strip.classList.remove('hidden');
            strip.classList.remove('detect-warning');
            strip.classList.add('detect-error');
            const pill = document.getElementById('import-detect-pill');
            if (pill) { pill.textContent = 'Detection failed'; pill.className = 'import-detect-pill pill-error'; }
        }
    } finally {
        if (btn) { (btn as any).disabled = false; btn.textContent = 'Detect Profile'; }
    }
}

function renderProfileDetectResult(result: { slug: string | null; displayName: string; evidence: string[]; isUnknown: boolean }) {
    const strip = document.getElementById('import-detect-strip');
    const pill = document.getElementById('import-detect-pill');
    const evidenceList = document.getElementById('import-detect-evidence');
    const toggleBtn = document.getElementById('import-detect-toggle');

    if (!strip || !pill || !evidenceList) return;

    strip.classList.remove('hidden', 'detect-error', 'detect-warning');
    pill.className = `import-detect-pill ${result.isUnknown ? 'pill-unknown' : 'pill-known'}`;
    pill.textContent = result.isUnknown ? 'Unknown profile' : result.displayName;

    evidenceList.innerHTML = result.evidence.length
        ? result.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')
        : '<li>No evidence gathered.</li>';

    if (result.isUnknown) {
        strip.classList.add('detect-warning');
        const hint = document.getElementById('import-submit-hint');
        if (hint) hint.textContent = 'Profile unknown — ingesting anyway with generic settings.';
    }

    toggleBtn?.addEventListener('click', () => {
        const hidden = evidenceList.classList.toggle('hidden');
        if (toggleBtn) toggleBtn.textContent = hidden ? 'Show evidence' : 'Hide evidence';
    }, { once: true });
}

export async function handleCreateProject() {
    const input = document.getElementById('new-project-name') as HTMLInputElement | null;
    const name = input?.value?.trim();
    if (!name) return;

    try {
        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error(await res.text());
        const project = await res.json();
        S.allProjects = await fetchProjects();
        if (input) input.value = '';
        document.getElementById('new-project-form')?.classList.add('hidden');

        resetExplorationStateForProjectSwitch();
        S.activeProjectId = project.id;
        S.activeProjectName = project.name;
        localStorage.setItem('sf_active_project', project.id);

        primeClientWithDashboard(createEmptyDashboard());

        updateProjectBadge();
        renderProjectsPanel();

        setActiveWorkspace('import');
        refreshWorkspace();
    } catch (err) {
        alert('Failed to create project: ' + (err as Error).message);
    }
}
