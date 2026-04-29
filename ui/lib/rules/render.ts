import { escapeAttribute, escapeHtml } from '../utils';
import {
    analyzeRuleSemantics,
    buildReferenceDisplay,
    formatComparisonOperatorLabel,
    formatFunctionDisplay,
    formatMethodDisplay,
    formatReferenceDisplay,
    formatRuleBody,
    type RuleActionViewModel,
    type RuleBranchViewModel,
    type RuleConditionViewModel,
    type RuleExpressionArgumentViewModel,
    type RuleExpressionViewModel,
    type RuleLookupPredicateViewModel,
    type RuleParameterViewModel,
    type RuleReferenceSegmentViewModel,
    type RuleSemanticModel,
    type RuleVariableViewModel
} from './semantic';

/* ===================================================================
   Rule Logic v2 — compact sentence-flow renderer
   ------------------------------------------------------------------
   Replaces the legacy verbose card-stack with a SAP-Fiori-native
   inline-token layout. Reuses `analyzeRuleSemantics()` so the parser
   contract is unchanged. The first branch expands by default; the
   rest stay collapsed behind a chevron summary. Pattern detectors
   compress noisy DSL constructs (delta-checks, permission guards,
   long formulas) so the median rule fits in the inspector viewport.

   Public surface kept stable for callers:
     - export function renderRuleLogicSection(node)
     - copy buttons keep `data-rule-copy="<encoded>"` (hooked up in
       inspector.ts:wireRuleLogicCopyButtons).
     - raw rule text stays inside <details class="rule-raw-toggle">
       with summary "View raw rule text".
   =================================================================== */

type RuleRenderNode = {
    id?: string;
    label?: string;
    body?: string | null;
    scenarioCode?: string | null;
    baseObjectAlias?: string | null;
    resolvedBaseObject?: string | null;
};

const MAX_COPY_ATTR_CHARS = 12000;
const MAX_INLINE_LITERAL = 60;
const MAX_INLINE_TOKEN = 80;
const MAX_GIST = 100;
const MAX_BRANCHES_OPEN_BY_DEFAULT = 1;
const CONDITION_PREVIEW_LIMIT = 4;
const ACTION_PREVIEW_LIMIT = 5;

/* ---------------- Public entry point ---------------- */

export function renderRuleLogicSection(node: RuleRenderNode): string {
    if (!node.body) {
        return `<section class="detail-section detail-section--rule-logic"><h4>Rule Logic</h4><p class="empty-mini">No rule body is available. Re-process the instance with the Object Definitions zip to populate rule logic.</p></section>`;
    }

    const model = analyzeRuleSemantics(node);
    const formattedRaw = formatRuleBody(node.body);
    const rawDetails = `<details class="rule-raw-toggle rule-v2-rawfallback"><summary>View raw rule text</summary><div class="rule-body-wrap"><pre class="rule-body-code">${escapeHtml(formattedRaw)}</pre></div></details>`;

    if (!model || (!model.branches.length && !model.signature.parameters.length)) {
        return `<section class="detail-section detail-section--rule-logic"><h4>Rule Logic</h4>${renderRawOnlyShell(formattedRaw)}${rawDetails}</section>`;
    }

    const stress = detectParserStress(model);

    const inner = stress
        ? renderStressFallback(model, stress)
        : renderSemanticBody(model, node);

    return `
        <section class="detail-section detail-section--rule-logic">
            <h4>Rule Logic</h4>
            <div class="rule-logic-v2">
                ${renderHeader(model, node)}
                ${renderConfidenceStrip(model)}
                ${inner}
            </div>
            ${rawDetails}
        </section>
    `;
}

/* ---------------- Top-level layout ---------------- */

function renderHeader(model: RuleSemanticModel, node: RuleRenderNode): string {
    const ruleName = model.signature.ruleName || node.label || node.id || 'Rule';
    const scenario = model.signature.scenario || node.scenarioCode || '';
    const baseObject = node.resolvedBaseObject || node.baseObjectAlias || '';
    const summary = model.summary;
    const meta: string[] = [];
    if (scenario) meta.push(`<span class="rule-v2-badge rule-v2-badge--neutral" title="Scenario">${escapeHtml(scenario)}</span>`);
    if (baseObject) meta.push(`<span class="rule-v2-badge rule-v2-badge--accent" title="Base object">${escapeHtml(baseObject)}</span>`);
    meta.push(`<span class="rule-v2-badge rule-v2-badge--accent" title="Branches">${summary.branchCount} branch${summary.branchCount === 1 ? '' : 'es'}</span>`);
    meta.push(`<span class="rule-v2-badge rule-v2-badge--accent" title="Conditions">${summary.conditionCount} condition${summary.conditionCount === 1 ? '' : 's'}</span>`);
    meta.push(`<span class="rule-v2-badge rule-v2-badge--accent" title="Actions">${summary.actionCount} action${summary.actionCount === 1 ? '' : 's'}</span>`);
    return `
        <div class="rule-v2-headerbar">
            <p class="rule-v2-eyebrow">Rule Logic</p>
            <h5 class="rule-v2-title">${escapeHtml(ruleName)}</h5>
            <div class="rule-v2-title-meta">${meta.join('')}</div>
        </div>
        ${renderParameters(model.signature.parameters)}
        ${renderVariables(model.variables)}
    `;
}

function renderConfidenceStrip(model: RuleSemanticModel): string {
    const c = model.summary.parseConfidence;
    if (c === 'high') return '';
    const cls = c === 'medium' ? 'rule-v2-strip--warn' : 'rule-v2-strip--err';
    const text = c === 'medium'
        ? 'Medium parse confidence: some actions are partially classified. Use the technical toggles or raw rule text to verify edge cases.'
        : 'Low parse confidence: several parts of the rule could not be classified cleanly. Use the technical toggles and raw rule text as the source of truth.';
    return `<div class="rule-v2-strip ${cls}"><span class="rule-v2-strip-icon" aria-hidden="true">ⓘ</span><div>${escapeHtml(text)}</div></div>`;
}

function renderParameters(parameters: RuleParameterViewModel[]): string {
    if (!parameters.length) return '';
    const collapsed = parameters.length > 3;
    const rows = parameters
        .map(p => `<tr><td><strong>${escapeHtml(p.displayName)}</strong><div class="rule-v2-table-tech">${escapeHtml(p.technicalName)}</div></td><td>${escapeHtml(p.objectType)}</td><td>${escapeHtml(p.accessHint)}</td></tr>`)
        .join('');
    const table = `<table class="rule-v2-table"><thead><tr><th>Name</th><th>Object</th><th>Access</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (collapsed) {
        return `<details class="rule-v2-vars" data-section="parameters"><summary>Parameters · ${parameters.length}</summary>${table}</details>`;
    }
    return `<div class="rule-v2-section" data-section="parameters"><div class="rule-v2-zone-label">Parameters · ${parameters.length}</div>${table}</div>`;
}

function renderVariables(variables: RuleVariableViewModel[]): string {
    if (!variables.length) {
        return `<div class="rule-v2-section" data-section="variables"><div class="rule-v2-zone-label">Variables</div><div class="rule-v2-clause" style="color:var(--muted)">No variables defined.</div></div>`;
    }
    const open = variables.length <= 2;
    const rows = variables.map(v => {
        const uses = v.usedBy.length
            ? `<div class="rule-v2-var-uses">Used in: ${v.usedBy.map(u => escapeHtml(truncate(u, 60))).join('; ')}</div>`
            : '';
        return `
            <div class="rule-v2-var-row">
                <span class="rule-tok rule-tok--var" title="${escapeAttribute(v.technicalName)}">${escapeHtml(v.displayName)}</span>
                <span class="rule-v2-assign">:=</span>
                ${renderExpressionInline(v.sourceExpression)}
                ${uses}
            </div>
        `;
    }).join('');
    return `<details class="rule-v2-vars" data-section="variables"${open ? ' open' : ''}><summary>Variables · ${variables.length}</summary>${rows}</details>`;
}

function renderSemanticBody(model: RuleSemanticModel, _node: RuleRenderNode): string {
    if (!model.branches.length) {
        return `<div class="rule-v2-section"><div class="rule-v2-zone-label">Rule Story</div><div class="rule-v2-clause" style="color:var(--muted)">No rule branches were recognized. Use the raw rule text below.</div></div>`;
    }
    const items = model.branches.map((b, i) => renderBranch(b, i)).join('');
    return `
        <div class="rule-v2-section" data-section="branches">
            <div class="rule-v2-zone-label">Rule Story · ${model.branches.length} branch${model.branches.length === 1 ? '' : 'es'}</div>
            <div class="rule-v2-branches">${items}</div>
        </div>
    `;
}

/* ---------------- Branch ---------------- */

function renderBranch(branch: RuleBranchViewModel, index: number): string {
    const kind = branch.type === 'if' ? 'if'
        : branch.type === 'elseif' ? 'elif'
        : branch.type === 'else' ? 'else'
        : 'statement';
    const labelText = branch.type === 'statement' ? 'DO' :
        branch.type === 'if' ? 'IF' :
        branch.type === 'elseif' ? 'ELSE IF' : 'ELSE';
    const open = index < MAX_BRANCHES_OPEN_BY_DEFAULT;

    const guards = extractPermissionGuards(branch);
    const guardChips = guards.length
        ? guards.map(g => `<span class="rule-tok rule-tok--perm" title="Permission guard">🔒 ${escapeHtml(truncate(g, 40))}</span>`).join('')
        : '';
    const conditionCount = branch.conditions.reduce((sum, condition) => sum + countConditionLeaves(condition), 0);
    const meta = `${conditionCount} condition${conditionCount === 1 ? '' : 's'} · ${branch.actions.length} action${branch.actions.length === 1 ? '' : 's'}`;
    const gist = summarizeBranchGist(branch);

    const head = `
        <summary class="rule-v2-branch__head">
            <span class="rule-v2-branch__label">${escapeHtml(labelText)}</span>
            <span class="rule-v2-branch__meta">${meta}</span>
            ${guardChips}
            ${gist ? `<span class="rule-v2-branch__gist">${gist}</span>` : ''}
        </summary>
    `;

    const body = renderBranchBody(branch);
    return `<details class="rule-v2-branch rule-v2-branch--${kind}" data-branch-index="${index}"${open ? ' open' : ''}>${head}${body}</details>`;
}

function renderBranchBody(branch: RuleBranchViewModel): string {
    const showWhen = branch.type === 'if' || branch.type === 'elseif';
    const whenZone = showWhen
        ? `<div class="rule-v2-zone"><div class="rule-v2-zone-label">When</div>${renderConditions(branch.conditions)}</div>`
        : '';
    const thenLabel = branch.type === 'statement' ? 'Do' : 'Then';
    const thenZone = `<div class="rule-v2-zone"><div class="rule-v2-zone-label">${thenLabel}</div>${renderActions(branch.actions)}</div>`;
    return `<div class="rule-v2-branch__body">${whenZone}${thenZone}</div>`;
}

/* ---------------- Conditions ---------------- */

function renderConditions(conditions: RuleConditionViewModel[]): string {
    if (!conditions.length) {
        return `<div class="rule-v2-clause" style="color:var(--muted)">No conditions detected.</div>`;
    }
    const visible = conditions.length > CONDITION_PREVIEW_LIMIT
        ? conditions.slice(0, CONDITION_PREVIEW_LIMIT)
        : conditions;
    const rest = conditions.length > CONDITION_PREVIEW_LIMIT
        ? conditions.slice(CONDITION_PREVIEW_LIMIT)
        : [];
    // Skip permission-only conditions that are already hoisted as guards in the head
    const cells = visible.map((c, i) => renderConditionCell(c, i, conditions[i + 1])).join('');
    const moreCells = rest.length
        ? `<details class="rule-v2-section"><summary class="rule-v2-more">…and ${rest.length} more condition${rest.length === 1 ? '' : 's'}</summary>${rest.map((c, i) => renderConditionCell(c, visible.length + i, conditions[visible.length + i + 1])).join('')}</details>`
        : '';
    return `${cells}${moreCells}`;
}

function renderConditionCell(condition: RuleConditionViewModel, _index: number, _next?: RuleConditionViewModel): string {
    if (condition.kind === 'always_true') {
        return `<div class="rule-v2-clause"><em style="color:var(--muted)">Always runs</em></div>`;
    }
    if (condition.kind === 'group') {
        const inner = renderConditionGroup(condition);
        const conn = condition.connectorToNext
            ? ` ${renderConnector(condition.connectorToNext)}`
            : '';
        return `<div class="rule-v2-clause">${inner}${conn}</div>`;
    }
    const inner = renderClauseInline(condition);
    const conn = condition.connectorToNext
        ? ` ${renderConnector(condition.connectorToNext)}`
        : '';
    return `<div class="rule-v2-clause">${inner}${conn}</div>`;
}

function renderConditionGroup(condition: RuleConditionViewModel): string {
    const children = condition.conditions || [];
    const label = condition.groupOperator === '&&' ? 'All of'
        : condition.groupOperator === '||' ? 'Any of'
        : 'Grouped logic';
    const kindClass = condition.groupOperator === '&&' ? 'and'
        : condition.groupOperator === '||' ? 'or'
        : 'mixed';
    const rows = children.map((child, index) => renderConditionCell(child, index, children[index + 1])).join('');
    return `
        <div class="rule-v2-condition-group rule-v2-condition-group--${kindClass}">
            <div class="rule-v2-condition-group__label">${escapeHtml(label)}</div>
            <div class="rule-v2-condition-group__body">${rows}</div>
        </div>
    `;
}

function renderClauseInline(condition: RuleConditionViewModel): string {
    // Pattern: previous-value delta — "unliteral(x.previousValue) != x.value"
    const delta = detectDeltaPattern(condition);
    if (delta) {
        return `<span class="rule-tok rule-tok--ref" title="${escapeAttribute(delta.fullPath)}">${escapeHtml(delta.displayPath)}</span> <span class="rule-tok rule-tok--delta" aria-label="Field changed">Δ changed</span>`;
    }

    if (condition.kind === 'comparison' && condition.comparison) {
        const { left, operator, right } = condition.comparison;
        const opWord = formatComparisonOperatorLabel(operator);
        return `${renderExpressionInline(left)} <span class="rule-v2-op rule-v2-op--word">${escapeHtml(opWord)}</span> ${renderExpressionInline(right)}`;
    }

    // Skip permission predicates rendered separately as guard chips
    if (isPermissionExpression(condition.expression)) {
        const groups = extractPermissionFromExpression(condition.expression);
        if (groups.length) {
            return groups.map(g => `<span class="rule-tok rule-tok--perm">🔒 ${escapeHtml(g)}</span>`).join(' ');
        }
    }

    if (condition.expression) {
        return renderExpressionInline(condition.expression);
    }
    return `<span class="rule-tok rule-tok--raw">${escapeHtml(truncate(condition.label, MAX_INLINE_TOKEN))}</span>`;
}

function renderConnector(connector: string): string {
    const cls = connector === '||' ? 'rule-connector rule-connector--or' : 'rule-connector';
    const label = connector === '||' ? 'OR' : connector === '&&' ? 'AND' : connector;
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

/* ---------------- Actions ---------------- */

function renderActions(actions: RuleActionViewModel[]): string {
    if (!actions.length) {
        return `<div class="rule-v2-act" style="color:var(--muted);border-left-color:transparent">No actions detected.</div>`;
    }
    const visible = actions.length > ACTION_PREVIEW_LIMIT
        ? actions.slice(0, ACTION_PREVIEW_LIMIT)
        : actions;
    const rest = actions.length > ACTION_PREVIEW_LIMIT
        ? actions.slice(ACTION_PREVIEW_LIMIT)
        : [];
    const head = visible.map(a => renderActionInline(a)).join('');
    const moreCells = rest.length
        ? `<details class="rule-v2-section"><summary class="rule-v2-more">…and ${rest.length} more action${rest.length === 1 ? '' : 's'}</summary>${rest.map(a => renderActionInline(a)).join('')}</details>`
        : '';
    return `${head}${moreCells}`;
}

function renderActionInline(action: RuleActionViewModel): string {
    switch (action.type) {
        case 'assignment':
            return `
                <div class="rule-v2-act rule-v2-act--assignment" data-action-type="assignment">
                    <span class="rule-v2-op rule-v2-op--word">Set</span>
                    ${renderExpressionInline(action.targetExpression)}
                    <span class="rule-v2-op rule-v2-op--word">to</span>
                    ${renderExpressionInline(action.value)}
                    ${renderTechnicalToggle(action.raw)}
                </div>
            `;
        case 'lookup_assignment':
            return `
                <div class="rule-v2-act rule-v2-act--lookup_assignment" data-action-type="lookup_assignment">
                    <span class="rule-v2-op rule-v2-op--word">Set</span>
                    ${renderExpressionInline(action.targetExpression)}
                    <span class="rule-v2-op rule-v2-op--word">from lookup</span>
                    <span class="rule-tok rule-tok--fn" title="Lookup table">${escapeHtml(action.lookupSource || 'Lookup')}</span>
                    <span class="rule-v2-op">→</span>
                    <span class="rule-tok rule-tok--ref" title="Selected field">${escapeHtml(action.selectField || 'Unknown')}</span>
                    ${renderLookupPredicates(action.predicates)}
                    ${renderTechnicalToggle(action.raw)}
                </div>
            `;
        case 'create_record':
            return `
                <div class="rule-v2-act rule-v2-act--create_record" data-action-type="create_record">
                    <span class="rule-v2-op rule-v2-op--word">⊕ Create</span>
                    <span class="rule-tok rule-tok--ref" title="${escapeAttribute(action.targetObject)}">${escapeHtml(action.targetObjectDisplay)}</span>
                    ${action.associationName ? `<span class="rule-v2-op rule-v2-op--word">in</span><span class="rule-tok rule-tok--var">${escapeHtml(action.associationName)}</span>` : ''}
                    ${renderCreateFields(action.fields)}
                    ${renderTechnicalToggle(action.raw)}
                </div>
            `;
        case 'method_call':
            if (action.methodName === 'removeAssociation') {
                return `
                    <div class="rule-v2-act rule-v2-act--method_call" data-action-type="method_call" data-method="removeAssociation">
                        <span class="rule-v2-op rule-v2-op--word">⊖ Remove from</span>
                        ${renderExpressionInline(action.calleeExpression)}
                        ${renderMethodArgsInline(action.args)}
                        ${renderTechnicalToggle(action.raw)}
                    </div>
                `;
            }
            return `
                <div class="rule-v2-act rule-v2-act--method_call" data-action-type="method_call">
                    ${renderExpressionInline(action.calleeExpression)}
                    <span class="rule-v2-op">.</span>
                    <span class="rule-tok rule-tok--fn">${escapeHtml(formatMethodDisplay(action.methodName))}</span>
                    ${renderMethodArgsInline(action.args)}
                    ${renderTechnicalToggle(action.raw)}
                </div>
            `;
        case 'raw':
            return `
                <div class="rule-v2-act rule-v2-act--raw" data-action-type="raw">
                    <span class="rule-v2-op rule-v2-op--word">Unclassified Action</span>
                    <span class="rule-tok rule-tok--raw">${escapeHtml(truncate(action.summary, 80))}</span>
                    ${renderTechnicalToggle(action.raw)}
                </div>
            `;
        default:
            return '';
    }
}

function renderCreateFields(fields: { displayName: string; technicalName: string; value: RuleExpressionViewModel }[]): string {
    if (!fields.length) return '';
    const rows = fields.map(f => `<tr><th>${escapeHtml(f.displayName)}</th><td>${renderExpressionInline(f.value)}</td></tr>`).join('');
    return `<details class="rule-v2-detail"><summary>${fields.length} field${fields.length === 1 ? '' : 's'}</summary><div class="rule-v2-detail-body"><table class="rule-v2-detail-tbl"><tbody>${rows}</tbody></table></div></details>`;
}

function renderLookupPredicates(predicates: RuleLookupPredicateViewModel[]): string {
    if (!predicates.length) return '';
    const rows = predicates
        .map(p => `<tr><td>${escapeHtml(p.field)}</td><td><em>${escapeHtml(p.operator)}</em></td><td>${renderExpressionInline(p.value)}</td></tr>`)
        .join('');
    return `<details class="rule-v2-detail"><summary>${predicates.length} where</summary><div class="rule-v2-detail-body"><table class="rule-v2-detail-tbl"><thead><tr><th>Field</th><th>Op</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function renderMethodArgsInline(args: RuleExpressionArgumentViewModel[]): string {
    if (!args.length) return `<span class="rule-v2-op">()</span>`;
    if (args.length <= 2) {
        const inner = args.map(a => `${a.label ? `<span class="rule-v2-op">${escapeHtml(a.label)}:</span>` : ''}${renderExpressionInline(a.value)}`).join('<span class="rule-v2-op">, </span>');
        return `<span class="rule-v2-op">(</span>${inner}<span class="rule-v2-op">)</span>`;
    }
    const rows = args
        .map(a => `<tr><th>${escapeHtml(a.label || 'arg')}</th><td>${renderExpressionInline(a.value)}</td></tr>`)
        .join('');
    return `<details class="rule-v2-detail"><summary>${args.length} args</summary><div class="rule-v2-detail-body"><table class="rule-v2-detail-tbl"><tbody>${rows}</tbody></table></div></details>`;
}

/* ---------------- Expression rendering (always inline) ---------------- */

function renderExpressionInline(expression: RuleExpressionViewModel | undefined | null): string {
    if (!expression) return `<span class="rule-tok rule-tok--raw">unknown</span>`;
    switch (expression.kind) {
        case 'literal':
            return renderLiteralToken(expression);
        case 'reference':
            return renderReferenceToken(expression.referencePath || []);
        case 'function':
            return renderFunctionToken(expression);
        case 'cast':
            return renderCastToken(expression);
        case 'array':
            return renderArrayToken(expression);
        case 'object':
            return `<span class="rule-tok rule-tok--object" title="${escapeAttribute(expression.raw)}">${escapeHtml(expression.display)}</span>`;
        case 'raw':
        default:
            return `<span class="rule-tok rule-tok--raw" title="${escapeAttribute(expression.raw)}">${escapeHtml(truncate(expression.display, MAX_INLINE_TOKEN))}</span>`;
    }
}

function renderCastToken(expression: RuleExpressionViewModel): string {
    const value = expression.castValue
        ? renderExpressionInline(expression.castValue)
        : `<span class="rule-tok rule-tok--raw">${escapeHtml(truncate(expression.raw, MAX_INLINE_TOKEN))}</span>`;
    return `${value}<span class="rule-tok rule-tok--type" title="Explicit type cast">as ${escapeHtml(expression.castType || 'type')}</span>`;
}

function renderArrayToken(expression: RuleExpressionViewModel): string {
    const items = expression.items || [];
    if (!items.length) return `<span class="rule-tok rule-tok--raw">[]</span>`;
    if (items.length <= 2) {
        return `<span class="rule-v2-op">[</span>${items.map(item => renderExpressionInline(item)).join('<span class="rule-v2-op">, </span>')}<span class="rule-v2-op">]</span>`;
    }
    return `<details class="rule-v2-detail"><summary>${items.length} items</summary><div class="rule-v2-detail-body">${items.map(item => renderExpressionInline(item)).join(' ')}</div></details>`;
}

function renderLiteralToken(expression: RuleExpressionViewModel): string {
    const t = expression.literalType || 'string';
    if (t === 'string') {
        const text = truncate(expression.display, MAX_INLINE_LITERAL);
        return `<span class="rule-tok rule-tok--lit-string" title="${escapeAttribute(expression.display)}">"${escapeHtml(text)}"</span>`;
    }
    if (t === 'number') {
        return `<span class="rule-tok rule-tok--lit-number">${escapeHtml(expression.display)}</span>`;
    }
    if (t === 'boolean') {
        const tone = expression.display.toLowerCase() === 'true' ? 'true' : 'false';
        return `<span class="rule-tok rule-tok--lit-boolean-${tone}">${escapeHtml(expression.display)}</span>`;
    }
    return `<span class="rule-tok rule-tok--lit-null">${escapeHtml(expression.display || 'Null')}</span>`;
}

function renderReferenceToken(path: RuleReferenceSegmentViewModel[]): string {
    if (!path.length) return `<span class="rule-tok rule-tok--raw">unknown</span>`;
    const full = buildReferenceDisplay(path);
    let display: string;
    if (path.length <= 3) {
        display = full;
    } else {
        const root = path[0]?.display ?? '';
        const tail = path[path.length - 1]?.display ?? '';
        display = `${root} › … › ${tail}`;
    }
    const truncated = truncate(display, MAX_INLINE_TOKEN);
    return `<span class="rule-tok rule-tok--ref" title="${escapeAttribute(full)}">${escapeHtml(truncated)}</span>`;
}

function renderFunctionToken(expression: RuleExpressionViewModel): string {
    const label = expression.functionLabel || formatFunctionDisplay(expression.functionName || expression.display);
    const subject = expression.subjectPath?.length ? renderReferenceToken(expression.subjectPath) : '';
    const trail = expression.trailPath?.length ? renderReferenceToken(expression.trailPath) : '';
    const args = expression.args || [];
    const argsInline = args.length === 0
        ? '<span class="rule-v2-op">()</span>'
        : args.length <= 2
            ? `<span class="rule-v2-op">(</span>${args.map(a => renderExpressionInline(a.value)).join('<span class="rule-v2-op">, </span>')}<span class="rule-v2-op">)</span>`
            : `<span class="rule-v2-op">(${args.length} args)</span>`;

    const fnTok = `<span class="rule-tok rule-tok--fn" title="${escapeAttribute(expression.functionPurpose || label)}">${escapeHtml(label)}</span>`;

    if (args.length > 2) {
        const argTable = args
            .map(a => `<tr><th>${escapeHtml(a.label || 'arg')}</th><td>${renderExpressionInline(a.value)}</td></tr>`)
            .join('');
        return `${subject}${subject ? '<span class="rule-v2-op">.</span>' : ''}${fnTok}<details class="rule-v2-detail"><summary>${args.length} args</summary><div class="rule-v2-detail-body"><table class="rule-v2-detail-tbl"><tbody>${argTable}</tbody></table></div></details>${trail ? '<span class="rule-v2-op">.</span>' : ''}${trail}`;
    }
    return `${subject}${subject ? '<span class="rule-v2-op">.</span>' : ''}${fnTok}${argsInline}${trail ? '<span class="rule-v2-op">.</span>' : ''}${trail}`;
}

/* ---------------- Pattern detectors ---------------- */

function detectDeltaPattern(condition: RuleConditionViewModel): { fullPath: string; displayPath: string } | null {
    if (condition.kind !== 'comparison' || !condition.comparison) return null;
    const { left, right, operator } = condition.comparison;
    if (operator !== '!=') return null;

    // Shape 1: unliteral(x.previousValue) != x.value
    const leftIsUnliteralPrev = left.kind === 'function'
        && (left.functionName === 'unliteral' || left.functionLabel === 'Current Value')
        && left.args && left.args[0]
        && referencePathHasSegment(left.args[0].value, 'previousValue');
    const rightIsValue = right.kind === 'reference' && referencePathHasSegment(right, 'value');
    if (leftIsUnliteralPrev && rightIsValue) {
        const path = right.referencePath?.slice(0, -1) || [];
        return {
            fullPath: buildReferenceDisplay(right.referencePath || []),
            displayPath: buildReferenceDisplay(path)
        };
    }
    // Shape 2 (mirror): x.value != unliteral(x.previousValue)
    const leftIsValue = left.kind === 'reference' && referencePathHasSegment(left, 'value');
    const rightIsUnliteralPrev = right.kind === 'function'
        && (right.functionName === 'unliteral' || right.functionLabel === 'Current Value')
        && right.args && right.args[0]
        && referencePathHasSegment(right.args[0].value, 'previousValue');
    if (leftIsValue && rightIsUnliteralPrev) {
        const path = left.referencePath?.slice(0, -1) || [];
        return {
            fullPath: buildReferenceDisplay(left.referencePath || []),
            displayPath: buildReferenceDisplay(path)
        };
    }
    return null;
}

function referencePathHasSegment(expression: RuleExpressionViewModel, qualifier: string): boolean {
    if (expression.kind !== 'reference' || !expression.referencePath) return false;
    const tail = expression.referencePath[expression.referencePath.length - 1];
    if (!tail) return false;
    return tail.raw.toLowerCase() === qualifier.toLowerCase()
        || tail.display.toLowerCase().includes(qualifier.toLowerCase().replace('previousvalue', 'previous value'));
}

function isPermissionExpression(expression: RuleExpressionViewModel | undefined): boolean {
    return collectPermissionGroupsFromExpression(expression).length > 0;
}

function extractPermissionFromExpression(expression: RuleExpressionViewModel | undefined): string[] {
    return collectPermissionGroupsFromExpression(expression);
}

function extractPermissionGuards(branch: RuleBranchViewModel): string[] {
    const guards = new Set<string>();
    for (const c of flattenConditions(branch.conditions)) {
        // Look in the comparison sides too, since some rules wrap permission checks in == "true"
        const candidates: RuleExpressionViewModel[] = [];
        if (c.expression) candidates.push(c.expression);
        if (c.comparison) {
            candidates.push(c.comparison.left);
            candidates.push(c.comparison.right);
        }
        for (const e of candidates) {
            if (isPermissionExpression(e)) {
                for (const g of extractPermissionFromExpression(e)) guards.add(g);
            }
        }
        // Also scan raw for the function name (catches deeply nested permission checks)
        if (!candidates.length || !candidates.some(isPermissionExpression)) {
            const m = c.raw.matchAll(/permissionGroupName\s*:\s*\[\s*"([^"]+)"/g);
            for (const match of m) guards.add(match[1]);
        }
    }
    return Array.from(guards).slice(0, 3);
}

function collectPermissionGroupsFromExpression(expression: RuleExpressionViewModel | undefined): string[] {
    if (!expression) return [];
    const groups = new Set<string>();
    const visit = (candidate: RuleExpressionViewModel | undefined) => {
        if (!candidate) return;
        if (candidate.kind === 'cast') {
            visit(candidate.castValue);
            return;
        }
        if (candidate.kind === 'array') {
            for (const item of candidate.items || []) visit(item);
            return;
        }
        if (candidate.kind !== 'function') return;
        const normalized = (candidate.functionName || '').split('.').pop()?.toLowerCase() || '';
        const isPermission = normalized.includes('isuserinpermissiongroup')
            || normalized.includes('whetheruserinpermissiongroup');
        if (isPermission) {
            const groupArg = (candidate.args || []).find(a => {
                const name = (a.name || '').toLowerCase();
                return name === 'permissiongroupname' || name === 'onlypermissiongroupname';
            });
            if (groupArg) {
                const matches = Array.from((groupArg.value.raw || '').matchAll(/"([^"]+)"/g)).map(m => m[1]);
                for (const match of matches.length ? matches : [groupArg.value.display]) {
                    if (match) groups.add(match);
                }
            }
        }
        for (const arg of candidate.args || []) visit(arg.value);
    };
    visit(expression);
    return Array.from(groups);
}

function flattenConditions(conditions: RuleConditionViewModel[]): RuleConditionViewModel[] {
    return conditions.flatMap(condition =>
        condition.kind === 'group'
            ? flattenConditions(condition.conditions || [])
            : [condition]);
}

function countConditionLeaves(condition: RuleConditionViewModel): number {
    if (condition.kind !== 'group') return 1;
    return (condition.conditions || []).reduce((sum, child) => sum + countConditionLeaves(child), 0);
}

function summarizeBranchGist(branch: RuleBranchViewModel): string {
    if (branch.type === 'else') return '';
    if (!branch.conditions.length && branch.actions.length) {
        const a = branch.actions[0];
        return escapeHtml(truncate(a.summary, MAX_GIST));
    }
    // Pick the first non-permission, non-always-true condition
    const candidate = flattenConditions(branch.conditions).find(c => {
        if (c.kind === 'always_true') return false;
        if (c.expression && isPermissionExpression(c.expression)) return false;
        if (c.comparison && (isPermissionExpression(c.comparison.left) || isPermissionExpression(c.comparison.right))) return false;
        return true;
    });
    if (!candidate) return '';
    const delta = detectDeltaPattern(candidate);
    if (delta) {
        return `${escapeHtml(truncate(delta.displayPath, MAX_GIST - 12))} <em>changed Δ</em>`;
    }
    if (candidate.kind === 'comparison' && candidate.comparison) {
        const lhs = describeExpressionShort(candidate.comparison.left);
        const op = formatComparisonOperatorLabel(candidate.comparison.operator);
        const rhs = describeExpressionShort(candidate.comparison.right);
        return escapeHtml(truncate(`${lhs} ${op} ${rhs}`, MAX_GIST));
    }
    return escapeHtml(truncate(candidate.label, MAX_GIST));
}

function describeExpressionShort(expression: RuleExpressionViewModel): string {
    if (expression.kind === 'literal') {
        if (expression.literalType === 'string') return `"${expression.display}"`;
        return expression.display;
    }
    if (expression.kind === 'reference') {
        const path = expression.referencePath || [];
        if (path.length <= 2) return path.map(p => p.display).join(' › ');
        const root = path[0]?.display || '';
        const tail = path[path.length - 1]?.display || '';
        return `${root} › … › ${tail}`;
    }
    if (expression.kind === 'function') {
        return `${expression.functionLabel || expression.functionName || 'fn'}(…)`;
    }
    if (expression.kind === 'cast') {
        const value = expression.castValue ? describeExpressionShort(expression.castValue) : expression.display;
        return `${value} as ${expression.castType || 'type'}`;
    }
    if (expression.kind === 'array') {
        return `${expression.items?.length || 0} items`;
    }
    if (expression.kind === 'object') {
        return expression.display;
    }
    return expression.display || '';
}

function detectParserStress(model: RuleSemanticModel): 'unbalanced' | null {
    const text = model.raw.normalized;
    if (!text) return null;
    let braceDelta = 0;
    let parenDelta = 0;
    let inString = false;
    let inHash = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const prev = i > 0 ? text[i - 1] : '';
        if (c === '"' && prev !== '\\') inString = !inString;
        if (!inString && c === '#') inHash = !inHash;
        if (inString || inHash) continue;
        if (c === '{') braceDelta++;
        else if (c === '}') braceDelta--;
        else if (c === '(') parenDelta++;
        else if (c === ')') parenDelta--;
    }
    if (Math.abs(braceDelta) > 0 || Math.abs(parenDelta) > 0) return 'unbalanced';
    return null;
}

function renderStressFallback(model: RuleSemanticModel, _kind: 'unbalanced'): string {
    const formatted = formatRuleBody(model.raw.normalized);
    return `
        <div class="rule-v2-strip rule-v2-strip--err">
            <span class="rule-v2-strip-icon" aria-hidden="true">⚠</span>
            <div>Heuristics could not classify this rule cleanly (unbalanced delimiters detected). Use the raw text below as the source of truth.</div>
        </div>
        <div class="rule-body-wrap"><pre class="rule-body-code">${escapeHtml(formatted)}</pre></div>
    `;
}

function renderRawOnlyShell(formattedRaw: string): string {
    return `
        <div class="rule-logic-v2">
            <div class="rule-v2-headerbar">
                <p class="rule-v2-eyebrow">Rule Logic</p>
                <h5 class="rule-v2-title">Raw rule text</h5>
            </div>
            <div class="rule-v2-strip rule-v2-strip--info">
                <span class="rule-v2-strip-icon" aria-hidden="true">ⓘ</span>
                <div>This rule could not be parsed into a semantic model. Inspect the source below.</div>
            </div>
            <div class="rule-body-wrap"><pre class="rule-body-code">${escapeHtml(formattedRaw)}</pre></div>
        </div>
    `;
}

/* ---------------- Technical toggle / copy ---------------- */

function renderTechnicalToggle(raw: string): string {
    return `
        <details class="rule-v2-tech"><summary aria-label="Technical action source"></summary>
            <div class="rule-v2-tech-toolbar">
                ${renderCopyControl(raw)}
                <pre>${escapeHtml(raw)}</pre>
            </div>
        </details>
    `;
}

function renderCopyControl(raw: string): string {
    const enc = encodeURIComponent(raw);
    if (enc.length > MAX_COPY_ATTR_CHARS) return '';
    return `<ui5-button class="rule-copy-btn" design="Transparent" icon="copy" tooltip="Copy to clipboard" data-rule-copy="${escapeAttribute(enc)}"></ui5-button>`;
}

/* ---------------- Utilities ---------------- */

function truncate(text: string, max: number): string {
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/* ---------------- Re-exports kept for compatibility ---------------- */

export {
    analyzeRuleSemantics,
    buildReferenceDisplay,
    formatRuleBody,
    formatReferenceDisplay
};
