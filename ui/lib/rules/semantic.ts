export type RuleParseConfidence = 'high' | 'medium' | 'low';

export type RuleReferenceSegmentKind =
    | 'root'
    | 'field'
    | 'qualifier'
    | 'method'
    | 'index'
    | 'filter';

export type RuleReferenceSegmentViewModel = {
    raw: string;
    display: string;
    kind: RuleReferenceSegmentKind;
};

export type RuleExpressionArgumentViewModel = {
    name: string | null;
    label: string | null;
    raw: string;
    value: RuleExpressionViewModel;
};

export type RuleExpressionViewModel = {
    kind: 'literal' | 'reference' | 'function' | 'cast' | 'array' | 'object' | 'raw';
    raw: string;
    display: string;
    literalType?: 'string' | 'number' | 'boolean' | 'null';
    referencePath?: RuleReferenceSegmentViewModel[];
    functionName?: string;
    functionLabel?: string;
    functionPurpose?: string;
    subjectPath?: RuleReferenceSegmentViewModel[];
    trailPath?: RuleReferenceSegmentViewModel[];
    args?: RuleExpressionArgumentViewModel[];
    castType?: string;
    castValue?: RuleExpressionViewModel;
    items?: RuleExpressionViewModel[];
    objectFieldCount?: number;
};

export type RuleConditionViewModel = {
    kind: 'always_true' | 'expression' | 'raw' | 'comparison' | 'group';
    raw: string;
    label: string;
    connectorToNext: string | null;
    groupOperator?: '&&' | '||' | 'mixed';
    conditions?: RuleConditionViewModel[];
    expression?: RuleExpressionViewModel;
    comparison?: {
        operator: string;
        left: RuleExpressionViewModel;
        right: RuleExpressionViewModel;
    };
};

export type RuleParameterViewModel = {
    technicalName: string;
    displayName: string;
    objectType: string;
    technicalType: string;
    accessHint: string;
    raw: string;
};

export type RuleVariableViewModel = {
    technicalName: string;
    displayName: string;
    sourceExpression: RuleExpressionViewModel;
    usedBy: string[];
};

export type RuleLookupPredicateViewModel = {
    field: string;
    operator: string;
    value: RuleExpressionViewModel;
    raw: string;
};

export type RuleFieldValueViewModel = {
    technicalName: string;
    displayName: string;
    value: RuleExpressionViewModel;
};

export type RuleActionViewModel =
    | {
        type: 'assignment';
        raw: string;
        summary: string;
        target: string;
        targetDisplay: string;
        targetExpression: RuleExpressionViewModel;
        value: RuleExpressionViewModel;
    }
    | {
        type: 'lookup_assignment';
        raw: string;
        summary: string;
        target: string;
        targetDisplay: string;
        targetExpression: RuleExpressionViewModel;
        lookupSource: string;
        selectField: string;
        predicates: RuleLookupPredicateViewModel[];
    }
    | {
        type: 'create_record';
        raw: string;
        summary: string;
        targetObject: string;
        targetObjectDisplay: string;
        targetExpression: RuleExpressionViewModel;
        associationName: string | null;
        fields: RuleFieldValueViewModel[];
    }
    | {
        type: 'method_call';
        raw: string;
        summary: string;
        callee: string;
        calleeDisplay: string;
        calleeExpression: RuleExpressionViewModel;
        methodName: string;
        methodDisplay: string;
        args: RuleExpressionArgumentViewModel[];
    }
    | {
        type: 'raw';
        raw: string;
        summary: string;
    };

export type RuleBranchViewModel = {
    type: 'if' | 'elseif' | 'else' | 'statement';
    label: string;
    conditions: RuleConditionViewModel[];
    actions: RuleActionViewModel[];
};

export type RuleSemanticModel = {
    signature: {
        ruleName: string | null;
        scenario: string | null;
        parameters: RuleParameterViewModel[];
    };
    variables: RuleVariableViewModel[];
    branches: RuleBranchViewModel[];
    summary: {
        branchCount: number;
        conditionCount: number;
        actionCount: number;
        recognizedActionCount: number;
        parseConfidence: RuleParseConfidence;
    };
    raw: {
        normalized: string;
    };
};

type RuleSemanticInput = {
    id?: string;
    label?: string;
    body?: string | null;
    scenarioCode?: string | null;
};

type BalancedSegment = {
    inner: string;
    endIndex: number;
};

type ParsedCall = {
    callee: string;
    args: string[];
    suffix: string;
};

type FunctionDescriptor = {
    label: string;
    purpose: string;
};

const VARIABLE_CONTAINERS = ['accrualrulevariables', 'rulevariables'];
const MAX_EXPRESSION_DEPTH = 4;

const FUNCTION_DESCRIPTORS: Record<string, FunctionDescriptor> = {
    literal: {
        label: 'Literal Value',
        purpose: 'Treat the input as a literal value.'
    },
    unliteral: {
        label: 'Current Value',
        purpose: 'Read the current value from a literal wrapper.'
    },
    round: {
        label: 'Round Result',
        purpose: 'Round the computed amount before writing it back.'
    },
    multiply: {
        label: 'Multiply Values',
        purpose: 'Multiply two business values.'
    },
    treatednullas: {
        label: 'Treat Null As',
        purpose: 'Replace a null input with a fallback value.'
    },
    getpayscaleamount: {
        label: 'Get Pay Scale Amount',
        purpose: 'Read the pay scale amount for the selected component and date.'
    },
    getpayscalecurrency: {
        label: 'Get Pay Scale Currency',
        purpose: 'Read the currency for the selected pay scale component.'
    },
    getpayscalefrequency: {
        label: 'Get Pay Scale Frequency',
        purpose: 'Read the frequency for the selected pay scale component.'
    },
    topayscalepaycomponents: {
        label: 'To Pay Scale Pay Components',
        purpose: 'Navigate from the pay scale level to related pay components.'
    },
    lookup: {
        label: 'Lookup',
        purpose: 'Read a value from a lookup table.'
    },
    differencecalendaryears: {
        label: 'Difference In Calendar Years',
        purpose: 'Calculate the year gap between two dates.'
    },
    dateplus: {
        label: 'Add To Date',
        purpose: 'Add months or days to a base date.'
    },
    generateexternalcodetimeoff: {
        label: 'Generate External Code',
        purpose: 'Create a generated external code.'
    },
    paycompamount: {
        label: 'Pay Component Amount',
        purpose: 'Read the amount for a pay component.'
    },
    matches: {
        label: 'Matches Pattern',
        purpose: 'Check whether a text value matches a pattern.'
    },
    indexof: {
        label: 'Find Text',
        purpose: 'Find text inside another text value.'
    },
    getcalendardays: {
        label: 'Calendar Days',
        purpose: 'Calculate calendar days between two dates.'
    },
    getnextworkingday: {
        label: 'Next Working Day',
        purpose: 'Find the next working day for a user.'
    },
    getpreviousworkingday: {
        label: 'Previous Working Day',
        purpose: 'Find the previous working day for a user.'
    },
    dayofweek: {
        label: 'Day Of Week',
        purpose: 'Read the weekday for a date.'
    },
    createdate: {
        label: 'Create Date',
        purpose: 'Build a date from year, month, and day parts.'
    },
    yearofdate: {
        label: 'Year Of Date',
        purpose: 'Read the year from a date.'
    },
    monthofyear: {
        label: 'Month Of Year',
        purpose: 'Read the month from a date.'
    },
    dayofmonth: {
        label: 'Day Of Month',
        purpose: 'Read the day of month from a date.'
    },
    concatenate: {
        label: 'Concatenate Text',
        purpose: 'Join text fragments.'
    },
    substring: {
        label: 'Substring',
        purpose: 'Extract part of a text value.'
    },
    substr: {
        label: 'Substring',
        purpose: 'Extract part of a text value.'
    }
};

export function analyzeRuleSemantics(input: RuleSemanticInput): RuleSemanticModel | null {
    if (!input?.body) return null;
    const normalized = normalizeRuleSource(input.body);
    const envelope = extractRuleEnvelope(normalized);
    const branches = parseRuleBranches(envelope.body);
    const variables = deriveVariables(branches);
    const summary = buildRuleSummary(branches);
    return {
        signature: {
            ruleName: (input.label || input.id || '').trim() || null,
            scenario: input.scenarioCode?.trim() || null,
            parameters: parseRuleParameters(envelope.signature)
        },
        variables,
        branches,
        summary,
        raw: { normalized }
    };
}

export function formatRuleBody(body: unknown): string {
    if (!body) return '';
    const text = normalizeRuleSource(String(body));
    let formatted = '';
    let indent = 0;
    let quoteOpen = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const prev = i > 0 ? text[i - 1] : '';
        if (char === '"' && prev !== '\\') {
            quoteOpen = !quoteOpen;
            formatted += char;
            continue;
        }
        if (quoteOpen) {
            formatted += char;
            continue;
        }
        if (char === '{') {
            formatted += ' {\n';
            indent += 1;
            formatted += '  '.repeat(indent);
            continue;
        }
        if (char === '}') {
            indent = Math.max(0, indent - 1);
            formatted = formatted.trimEnd();
            formatted += `\n${'  '.repeat(indent)}}`;
            if (i < text.length - 1) formatted += `\n${'  '.repeat(indent)}`;
            continue;
        }
        if (char === ';') {
            formatted += ';\n';
            formatted += '  '.repeat(indent);
            continue;
        }
        formatted += char;
    }
    return formatted
        .split('\n')
        .map(line => line.trimEnd())
        .filter((line, index, lines) => !(line === '' && lines[index - 1] === ''))
        .join('\n')
        .trim();
}

function normalizeRuleSource(body: string): string {
    return body.replace(/\r\n/g, '\n').trim();
}

function extractRuleEnvelope(source: string): { signature: string; body: string } {
    const trimmed = source.trim();
    if (!trimmed.toLowerCase().startsWith('rule')) {
        return { signature: '', body: trimmed };
    }
    const openParen = trimmed.indexOf('(');
    if (openParen === -1) return { signature: '', body: trimmed };
    const signature = extractBalancedSegment(trimmed, openParen, '(', ')');
    if (!signature) return { signature: '', body: trimmed };
    const braceIndex = trimmed.indexOf('{', signature.endIndex + 1);
    if (braceIndex === -1) {
        return { signature: signature.inner, body: trimmed.slice(signature.endIndex + 1).trim() };
    }
    const body = extractBalancedSegment(trimmed, braceIndex, '{', '}');
    return {
        signature: signature.inner,
        body: body?.inner?.trim() || trimmed.slice(braceIndex + 1).trim()
    };
}

function parseRuleParameters(signature: string): RuleParameterViewModel[] {
    if (!signature.trim()) return [];
    return splitTopLevel(signature, ',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(raw => {
            const spaceIndex = findLastTopLevelWhitespace(raw);
            const technicalName = spaceIndex === -1 ? raw : raw.slice(spaceIndex).trim();
            const descriptor = spaceIndex === -1 ? raw : raw.slice(0, spaceIndex).trim();
            const labelMatch = descriptor.match(/\("([^"]*)"\)/);
            const technicalType = descriptor.replace(/\("([^"]*)"\)/, '').trim();
            const objectType = technicalType.split(':').pop() || technicalType;
            return {
                technicalName,
                displayName: labelMatch?.[1]?.trim() || technicalName,
                objectType,
                technicalType,
                accessHint: inferAccessHint(objectType, technicalName),
                raw
            };
        });
}

function inferAccessHint(objectType: string, technicalName: string): string {
    const type = objectType.toLowerCase();
    const name = technicalName.toLowerCase();
    if (type.includes('systemcontext') || name === 'context') return 'Read-only';
    if (type.includes('parameters') || type.includes('variables')) return 'Full';
    if (type.includes('timeaccount')) return 'Full';
    return 'Unknown';
}

function parseRuleBranches(body: string): RuleBranchViewModel[] {
    const branches: RuleBranchViewModel[] = [];
    let cursor = 0;
    while (cursor < body.length) {
        cursor = skipWhitespace(body, cursor);
        if (cursor >= body.length) break;
        if (startsWithToken(body, cursor, 'if')) {
            const parsed = parseConditionalBranch(body, cursor, 'if');
            if (!parsed) break;
            branches.push(parsed.branch);
            cursor = parsed.nextIndex;
            continue;
        }
        if (startsWithToken(body, cursor, 'else')) {
            const afterElse = skipWhitespace(body, cursor + 4);
            if (startsWithToken(body, afterElse, 'if')) {
                const parsed = parseConditionalBranch(body, afterElse, 'elseif');
                if (!parsed) break;
                branches.push(parsed.branch);
                cursor = parsed.nextIndex;
                continue;
            }
            const elseBody = parseBlockBody(body, afterElse);
            if (!elseBody) break;
            branches.push({
                type: 'else',
                label: 'Else',
                conditions: [],
                actions: parseRuleActions(elseBody.inner)
            });
            cursor = elseBody.endIndex + 1;
            continue;
        }
        const statement = readTopLevelStatement(body, cursor);
        if (!statement) break;
        branches.push({
            type: 'statement',
            label: 'Statement',
            conditions: [],
            actions: parseRuleActions(statement.statement)
        });
        cursor = statement.nextIndex;
    }
    return branches;
}

function parseConditionalBranch(body: string, startIndex: number, kind: 'if' | 'elseif'): { branch: RuleBranchViewModel; nextIndex: number } | null {
    const keywordIndex = body.indexOf('(', startIndex);
    if (keywordIndex === -1) return null;
    const condition = extractBalancedSegment(body, keywordIndex, '(', ')');
    if (!condition) return null;
    const block = parseBlockBody(body, condition.endIndex + 1);
    if (!block) return null;
    return {
        branch: {
            type: kind,
            label: kind === 'if' ? 'If' : 'Else If',
            conditions: parseRuleConditions(condition.inner),
            actions: parseRuleActions(block.inner)
        },
        nextIndex: block.endIndex + 1
    };
}

function parseBlockBody(body: string, startIndex: number): BalancedSegment | null {
    const braceIndex = body.indexOf('{', skipWhitespace(body, startIndex));
    if (braceIndex === -1) return null;
    return extractBalancedSegment(body, braceIndex, '{', '}');
}

export function formatComparisonOperatorLabel(operator: string): string {
    switch (operator) {
        case '!=':
            return 'is not equal to';
        case '==':
            return 'is equal to';
        case '<=':
            return 'is less than or equal to';
        case '>=':
            return 'is greater than or equal to';
        case '<':
            return 'is less than';
        case '>':
            return 'is greater than';
        default:
            return operator;
    }
}

export function splitTopLevelRelational(text: string): { left: string; operator: string; right: string } | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    const twoCharOps = ['<=', '>=', '==', '!='] as const;

    for (let i = 0; i < trimmed.length; i += 1) {
        const char = trimmed[i];
        const prev = i > 0 ? trimmed[i - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;

        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);

        if (parenDepth || bracketDepth || braceDepth) continue;

        const two = trimmed.slice(i, i + 2);
        for (const op of twoCharOps) {
            if (two === op) {
                const left = trimmed.slice(0, i).trim();
                const right = trimmed.slice(i + op.length).trim();
                if (!left || !right) return null;
                return { left, operator: op, right };
            }
        }

        if (char === '<' || char === '>') {
            const left = trimmed.slice(0, i).trim();
            const right = trimmed.slice(i + 1).trim();
            if (!left || !right) return null;
            return { left, operator: char, right };
        }
    }

    return null;
}

function parseRuleConditions(conditionText: string): RuleConditionViewModel[] {
    const trimmed = conditionText.trim();
    if (!trimmed) return [];
    if (trimmed === 'true') {
        return [{ kind: 'always_true', raw: 'true', label: 'Always true', connectorToNext: null }];
    }
    const tokens = splitConditionParts(trimmed);
    return tokens.conditions.map((raw, index) => parseConditionNode(raw, tokens.connectors[index] || null));
}

function parseConditionNode(rawCondition: string, connectorToNext: string | null): RuleConditionViewModel {
    const raw = rawCondition.trim();
    const unwrapped = stripWrappingParens(raw);
    const tokens = splitConditionParts(unwrapped);
    if (tokens.conditions.length > 1) {
        const groupOperator = new Set(tokens.connectors).size === 1
            ? tokens.connectors[0] as '&&' | '||'
            : 'mixed';
        const children = tokens.conditions.map((part, index) =>
            parseConditionNode(part, tokens.connectors[index] || null));
        return {
            kind: 'group',
            raw,
            label: groupOperator === '&&' ? 'All of' : groupOperator === '||' ? 'Any of' : 'Grouped logic',
            connectorToNext,
            groupOperator,
            conditions: children
        };
    }
    return parseConditionLeaf(unwrapped, connectorToNext, raw);
}

function parseConditionLeaf(text: string, connectorToNext: string | null, rawOverride?: string): RuleConditionViewModel {
    const raw = rawOverride || text;
    if (text === 'true') {
        return { kind: 'always_true', raw, label: 'Always true', connectorToNext };
    }
    const rel = splitTopLevelRelational(text);
    if (rel) {
        const leftExpr = parseExpression(rel.left, 0);
        const rightExpr = parseExpression(rel.right, 0);
        const opLabel = formatComparisonOperatorLabel(rel.operator);
        return {
            kind: 'comparison',
            raw,
            label: `${leftExpr.display} ${opLabel} ${rightExpr.display}`,
            connectorToNext,
            comparison: {
                operator: rel.operator,
                left: leftExpr,
                right: rightExpr
            }
        };
    }
    const expression = parseExpression(text, 0);
    return {
        kind: expression.kind === 'raw' ? 'raw' : 'expression',
        raw,
        label: expression.kind === 'raw' ? raw : expression.display,
        connectorToNext,
        expression
    };
}

function parseRuleActions(bodyText: string): RuleActionViewModel[] {
    return splitTopLevelStatements(bodyText)
        .map(statement => parseOneAction(statement))
        .filter((action): action is RuleActionViewModel => Boolean(action));
}

function parseOneAction(statement: string): RuleActionViewModel | null {
    const raw = statement.trim().replace(/;$/, '').trim();
    if (!raw) return null;
    const assignmentIndex = findTopLevelAssignmentIndex(raw);
    if (assignmentIndex > -1) {
        const target = raw.slice(0, assignmentIndex).trim();
        const valueRaw = raw.slice(assignmentIndex + 1).trim();
        const targetExpression = parseExpression(target, 0);
        if (valueRaw.startsWith('lookup(')) {
            return parseLookupAssignment(target, targetExpression, valueRaw, raw);
        }
        const expression = parseExpression(valueRaw, 0);
        return {
            type: 'assignment',
            raw,
            summary: `Set ${formatReferenceDisplay(target)} to ${expression.display}`,
            target,
            targetDisplay: formatReferenceDisplay(target),
            targetExpression,
            value: expression
        };
    }

    const call = parseCall(raw);
    if (call) {
        const lastDot = call.callee.lastIndexOf('.');
        const callee = lastDot === -1 ? '' : call.callee.slice(0, lastDot);
        const methodName = lastDot === -1 ? call.callee : call.callee.slice(lastDot + 1);
        if (methodName === 'addAssociation') {
            const createRecord = parseCreateRecordAction(raw, callee, call.args);
            if (createRecord) return createRecord;
        }
        const args = call.args.map(arg => parseExpressionArgument(arg, 0));
        const calleeExpression = parseExpression(call.callee, 0);
        return {
            type: 'method_call',
            raw,
            summary: `${formatReferenceDisplay(callee || call.callee)}.${formatTokenDisplay(methodName)}`,
            callee,
            calleeDisplay: callee ? formatReferenceDisplay(callee) : formatReferenceDisplay(call.callee),
            calleeExpression,
            methodName,
            methodDisplay: formatMethodDisplay(methodName),
            args
        };
    }

    return {
        type: 'raw',
        raw,
        summary: raw.length > 72 ? `${raw.slice(0, 69)}...` : raw
    };
}

function parseLookupAssignment(
    target: string,
    targetExpression: RuleExpressionViewModel,
    valueRaw: string,
    raw: string
): RuleActionViewModel {
    const call = parseCall(valueRaw);
    if (!call) {
        return {
            type: 'raw',
            raw,
            summary: raw.length > 72 ? `${raw.slice(0, 69)}...` : raw
        };
    }
    const lookupSource = stripWrappingQuotes(call.args[0] || '');
    const selectField = stripWrappingQuotes(call.args[1] || '');
    return {
        type: 'lookup_assignment',
        raw,
        summary: `Set ${formatReferenceDisplay(target)} from lookup ${lookupSource || 'source'}`,
        target,
        targetDisplay: formatReferenceDisplay(target),
        targetExpression,
        lookupSource,
        selectField,
        predicates: parseLookupPredicates(call.args[3] || '')
    };
}

function parseLookupPredicates(rawArray: string): RuleLookupPredicateViewModel[] {
    const trimmed = rawArray.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
    const inner = trimmed.slice(1, -1);
    const parts = splitTopLevel(inner, ',').map(part => part.trim());
    const predicates: RuleLookupPredicateViewModel[] = [];
    for (let index = 0; index < parts.length; index += 5) {
        const field = stripWrappingQuotes(parts[index] || '');
        const operator = stripWrappingQuotes(parts[index + 1] || '');
        const valueRaw = (parts[index + 2] || '').trim();
        if (!field || !operator || !valueRaw) continue;
        predicates.push({
            field,
            operator,
            value: parseExpression(valueRaw, 0),
            raw: `${field} ${operator} ${valueRaw}`
        });
    }
    return predicates;
}

function parseCreateRecordAction(raw: string, callee: string, args: string[]): RuleActionViewModel | null {
    const namedArgs = args.map(arg => parseExpressionArgument(arg, 0));
    const associationName = namedArgs.find(arg => arg.name === 'associationName')?.value.raw || '';
    const associationPayload = namedArgs.find(arg => arg.name === 'association')?.value.raw || '';
    const parsedNew = parseNewPayload(associationPayload);
    if (!parsedNew) return null;
    const objectName = stripWrappingQuotes(associationName);
    const targetObject = objectName ? `${callee}.${objectName}` : callee;
    return {
        type: 'create_record',
        raw,
        summary: `Create ${formatReferenceDisplay(targetObject)}`,
        targetObject,
        targetObjectDisplay: formatReferenceDisplay(targetObject),
        targetExpression: parseExpression(targetObject, 0),
        associationName: objectName || null,
        fields: parsedNew
    };
}

function parseNewPayload(raw: string): RuleFieldValueViewModel[] | null {
    const trimmed = raw.trim();
    if (!trimmed.toLowerCase().startsWith('new')) return null;
    const openParen = trimmed.indexOf('(');
    if (openParen === -1) return null;
    const payload = extractBalancedSegment(trimmed, openParen, '(', ')');
    if (!payload) return null;
    return splitTopLevel(payload.inner, ',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(field => {
            const colon = findTopLevelColon(field);
            if (colon === -1) {
                return {
                    technicalName: field,
                    displayName: formatTokenDisplay(field),
                    value: parseExpression(field, 0)
                };
            }
            const technicalName = field.slice(0, colon).trim();
            const valueRaw = field.slice(colon + 1).trim();
            return {
                technicalName,
                displayName: formatTokenDisplay(technicalName),
                value: parseExpression(valueRaw, 0)
            };
        });
}

function parseExpression(raw: string, depth: number): RuleExpressionViewModel {
    const trimmed = raw.trim();
    if (!trimmed) return { kind: 'raw', raw: trimmed, display: '' };
    if (depth > MAX_EXPRESSION_DEPTH) {
        return { kind: 'raw', raw: trimmed, display: trimmed };
    }
    const cast = splitTopLevelCast(trimmed);
    if (cast) {
        const value = parseExpression(cast.value, depth + 1);
        return {
            kind: 'cast',
            raw: trimmed,
            display: `${value.display} as ${cast.type}`,
            castType: cast.type,
            castValue: value
        };
    }
    if (trimmed === 'true' || trimmed === 'false') {
        return {
            kind: 'literal',
            raw: trimmed,
            display: trimmed === 'true' ? 'True' : 'False',
            literalType: 'boolean'
        };
    }
    if (trimmed === 'null') {
        return {
            kind: 'literal',
            raw: trimmed,
            display: 'Null',
            literalType: 'null'
        };
    }
    if (/^".*"$/.test(trimmed)) {
        return {
            kind: 'literal',
            raw: trimmed,
            display: stripWrappingQuotes(trimmed),
            literalType: 'string'
        };
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return {
            kind: 'literal',
            raw: trimmed,
            display: trimmed,
            literalType: 'number'
        };
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const segment = extractBalancedSegment(trimmed, 0, '[', ']');
        if (segment && segment.endIndex === trimmed.length - 1) {
            const items = splitTopLevel(segment.inner, ',')
                .map(part => part.trim())
                .filter(Boolean)
                .map(part => parseExpression(part, depth + 1));
            return {
                kind: 'array',
                raw: trimmed,
                display: items.map(item => item.display).join(', '),
                items
            };
        }
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const segment = extractBalancedSegment(trimmed, 0, '{', '}');
        if (segment && segment.endIndex === trimmed.length - 1) {
            const fieldCount = segment.inner.trim()
                ? splitTopLevel(segment.inner, ',').filter(part => part.trim()).length
                : 0;
            return {
                kind: 'object',
                raw: trimmed,
                display: fieldCount ? `{ ${fieldCount} fields }` : '{}',
                objectFieldCount: fieldCount
            };
        }
    }
    if (trimmed.startsWith('#') && trimmed.endsWith('#')) {
        return {
            kind: 'reference',
            raw: trimmed,
            display: formatBracketSegmentLabel(trimmed),
            referencePath: [{
                raw: trimmed,
                display: formatBracketSegmentLabel(trimmed),
                kind: 'filter'
            }]
        };
    }

    const functionExpression = parseFunctionExpression(trimmed, depth);
    if (functionExpression) return functionExpression;

    const referencePath = parseReferenceSegments(trimmed);
    if (referencePath?.length) {
        return {
            kind: 'reference',
            raw: trimmed,
            display: buildReferenceDisplay(referencePath),
            referencePath
        };
    }

    return {
        kind: 'raw',
        raw: trimmed,
        display: trimmed
    };
}

function parseFunctionExpression(text: string, depth: number): RuleExpressionViewModel | null {
    const call = parseCall(text);
    if (!call) return null;

    const calleeParts = splitTopLevelPath(call.callee);
    const functionToken = calleeParts.pop() || call.callee;
    const descriptor = describeFunction(functionToken);
    const subjectPath = calleeParts.length ? buildPathSegmentsFromParts(calleeParts, true) : undefined;
    const parsedTrailPath = call.suffix
        ? parseReferenceSegments(call.suffix.startsWith('.') ? call.suffix.slice(1) : call.suffix)
        : null;
    const trailPath = parsedTrailPath || undefined;
    const args = depth >= MAX_EXPRESSION_DEPTH
        ? []
        : call.args.map(arg => parseExpressionArgument(arg, depth + 1));

    return {
        kind: 'function',
        raw: text,
        display: buildFunctionDisplay(descriptor.label, args, subjectPath, trailPath),
        functionName: call.callee,
        functionLabel: descriptor.label,
        functionPurpose: descriptor.purpose,
        subjectPath,
        trailPath,
        args
    };
}

function parseExpressionArgument(raw: string, depth: number): RuleExpressionArgumentViewModel {
    const colon = findTopLevelColon(raw);
    if (colon === -1) {
        return {
            name: null,
            label: null,
            raw,
            value: parseExpression(raw, depth)
        };
    }
    const name = raw.slice(0, colon).trim();
    const valueRaw = raw.slice(colon + 1).trim();
    return {
        name,
        label: formatTokenDisplay(name),
        raw,
        value: parseExpression(valueRaw, depth)
    };
}

function deriveVariables(branches: RuleBranchViewModel[]): RuleVariableViewModel[] {
    const variables = new Map<string, RuleVariableViewModel>();
    const orderedActions = branches.flatMap(branch => branch.actions);
    orderedActions.forEach((action, actionIndex) => {
        if (action.type !== 'assignment' && action.type !== 'lookup_assignment') return;
        const container = action.target.split('.')[0]?.toLowerCase();
        if (!VARIABLE_CONTAINERS.includes(container)) return;
        const technicalName = action.target;
        const displayName = formatReferenceDisplay(action.target);
        const usedBy = orderedActions
            .slice(actionIndex + 1)
            .filter(candidate => candidate.raw.includes(technicalName))
            .map(candidate => candidate.summary)
            .slice(0, 3);
        variables.set(technicalName, {
            technicalName,
            displayName,
            sourceExpression: action.type === 'assignment'
                ? action.value
                : {
                    kind: 'function',
                    raw: action.raw,
                    display: `Lookup ${action.lookupSource || 'source'} -> ${action.selectField || 'field'}`,
                    functionName: 'lookup',
                    functionLabel: describeFunction('lookup').label,
                    functionPurpose: describeFunction('lookup').purpose,
                    args: []
                },
            usedBy
        });
    });
    return Array.from(variables.values());
}

function buildRuleSummary(branches: RuleBranchViewModel[]) {
    const branchCount = branches.length;
    const conditionCount = branches.reduce((sum, branch) =>
        sum + branch.conditions.reduce((conditionSum, condition) => conditionSum + countConditionLeaves(condition), 0), 0);
    const actionCount = branches.reduce((sum, branch) => sum + branch.actions.length, 0);
    const recognizedActionCount = branches.reduce((sum, branch) =>
        sum + branch.actions.filter(action => action.type !== 'raw').length, 0);
    const ratio = actionCount === 0 ? 1 : recognizedActionCount / actionCount;
    const parseConfidence: RuleParseConfidence = ratio >= 0.85 ? 'high' : ratio >= 0.5 ? 'medium' : 'low';
    return {
        branchCount,
        conditionCount,
        actionCount,
        recognizedActionCount,
        parseConfidence
    };
}

function countConditionLeaves(condition: RuleConditionViewModel): number {
    if (condition.kind !== 'group') return 1;
    return (condition.conditions || []).reduce((sum, child) => sum + countConditionLeaves(child), 0);
}

function stripWrappingParens(text: string): string {
    let trimmed = text.trim();
    while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        const segment = extractBalancedSegment(trimmed, 0, '(', ')');
        if (!segment || segment.endIndex !== trimmed.length - 1) break;
        trimmed = segment.inner.trim();
    }
    return trimmed;
}

function splitConditionParts(text: string): { conditions: string[]; connectors: string[] } {
    const conditions: string[] = [];
    const connectors: string[] = [];
    let start = 0;
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1] || '';
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (parenDepth || bracketDepth || braceDepth) continue;
        if (char === '&' && next === '&') {
            conditions.push(text.slice(start, index).trim());
            connectors.push('&&');
            start = index + 2;
            index += 1;
        } else if (char === '|' && next === '|') {
            conditions.push(text.slice(start, index).trim());
            connectors.push('||');
            start = index + 2;
            index += 1;
        }
    }
    conditions.push(text.slice(start).trim());
    return {
        conditions: conditions.filter(Boolean),
        connectors
    };
}

function parseCall(text: string): ParsedCall | null {
    const trimmed = text.trim();
    const openParen = findFirstTopLevelParen(trimmed);
    if (openParen <= 0) return null;
    const callee = trimmed.slice(0, openParen).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.:]*$/.test(callee)) return null;
    const segment = extractBalancedSegment(trimmed, openParen, '(', ')');
    if (!segment) return null;
    const suffix = trimmed.slice(segment.endIndex + 1).trim();
    if (suffix && !isValidReferenceSuffix(suffix)) return null;
    return {
        callee,
        args: splitTopLevel(segment.inner, ',').map(arg => arg.trim()).filter(Boolean),
        suffix
    };
}

function splitTopLevelStatements(text: string): string[] {
    const statements: string[] = [];
    let start = 0;
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (char === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            statements.push(text.slice(start, index + 1).trim());
            start = index + 1;
        }
    }
    const trailing = text.slice(start).trim();
    if (trailing) statements.push(trailing);
    return statements.filter(Boolean);
}

function splitTopLevel(text: string, delimiter: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (char === delimiter && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            parts.push(text.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

function splitTopLevelCast(text: string): { value: string; type: string } | null {
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (parenDepth || bracketDepth || braceDepth) continue;
        if (text.slice(index, index + 4).toLowerCase() !== ' as ') continue;
        const value = text.slice(0, index).trim();
        const type = text.slice(index + 4).trim();
        if (!value || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(type)) return null;
        return { value, type };
    }
    return null;
}

function extractBalancedSegment(text: string, startIndex: number, open: string, close: string): BalancedSegment | null {
    if (text[startIndex] !== open) return null;
    let depth = 0;
    let quoteOpen = false;
    let hashFence = false;
    for (let index = startIndex; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === open) depth += 1;
        else if (char === close) depth -= 1;
        if (depth === 0) {
            return {
                inner: text.slice(startIndex + 1, index),
                endIndex: index
            };
        }
    }
    return null;
}

function findTopLevelAssignmentIndex(text: string): number {
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        const next = text[index + 1] || '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (parenDepth || bracketDepth || braceDepth) continue;
        if (char !== '=') continue;
        if (prev === '=' || prev === '!' || prev === '<' || prev === '>') continue;
        if (next === '=') continue;
        return index;
    }
    return -1;
}

function findTopLevelColon(text: string): number {
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (parenDepth || bracketDepth || braceDepth) continue;
        if (char === ':') return index;
    }
    return -1;
}

function readTopLevelStatement(body: string, startIndex: number): { statement: string; nextIndex: number } | null {
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = startIndex; index < body.length; index += 1) {
        const char = body[index];
        const prev = index > 0 ? body[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (char === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            return {
                statement: body.slice(startIndex, index + 1).trim(),
                nextIndex: index + 1
            };
        }
    }
    const trailing = body.slice(startIndex).trim();
    if (!trailing) return null;
    return {
        statement: trailing,
        nextIndex: body.length
    };
}

function skipWhitespace(text: string, startIndex: number): number {
    let cursor = startIndex;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    return cursor;
}

function startsWithToken(text: string, startIndex: number, token: string): boolean {
    const slice = text.slice(startIndex, startIndex + token.length);
    if (slice !== token) return false;
    const next = text[startIndex + token.length] || '';
    return !next || /\s|\(/.test(next);
}

function findLastTopLevelWhitespace(text: string): number {
    let quoteOpen = false;
    let parenDepth = 0;
    for (let index = text.length - 1; index >= 0; index -= 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (quoteOpen) continue;
        if (char === ')') parenDepth += 1;
        else if (char === '(') parenDepth = Math.max(0, parenDepth - 1);
        if (parenDepth === 0 && /\s/.test(char)) return index;
    }
    return -1;
}

function findFirstTopLevelParen(text: string): number {
    let quoteOpen = false;
    let hashFence = false;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (bracketDepth || braceDepth) continue;
        if (char === '(') return index;
    }
    return -1;
}

function stripWrappingQuotes(text: string): string {
    const trimmed = text.trim();
    return trimmed.startsWith('"') && trimmed.endsWith('"')
        ? trimmed.slice(1, -1)
        : trimmed;
}

function describeFunction(name: string): FunctionDescriptor {
    const normalized = name.split('.').pop()?.toLowerCase() || name.toLowerCase();
    return FUNCTION_DESCRIPTORS[normalized] || {
        label: formatTokenDisplay(name.split('.').pop() || name),
        purpose: 'Evaluate this function and use its result in the rule.'
    };
}

function formatFunctionDisplay(name: string): string {
    return describeFunction(name).label;
}

function formatMethodDisplay(name: string): string {
    if (name === 'addAssociation') return 'Create Related Record';
    return formatTokenDisplay(name);
}

function buildFunctionDisplay(
    label: string,
    args: RuleExpressionArgumentViewModel[],
    subjectPath?: RuleReferenceSegmentViewModel[],
    trailPath?: RuleReferenceSegmentViewModel[]
): string {
    const parts: string[] = [];
    if (subjectPath?.length) parts.push(buildReferenceDisplay(subjectPath));
    parts.push(`${label}(${args.map(arg => arg.label || arg.value.display).join(', ')})`);
    if (trailPath?.length) parts.push(buildReferenceDisplay(trailPath));
    return parts.join(' > ');
}

function formatArgumentPreview(raw: string): string {
    const colon = findTopLevelColon(raw);
    if (colon === -1) return formatReferenceDisplay(raw.trim());
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    return `${formatTokenDisplay(name)}: ${formatReferenceDisplay(value)}`;
}

function buildReferenceDisplay(segments: RuleReferenceSegmentViewModel[]): string {
    return segments.map(segment => segment.display).join(' > ');
}

function buildPathSegmentsFromParts(parts: string[], firstIsRoot: boolean): RuleReferenceSegmentViewModel[] {
    const segments: RuleReferenceSegmentViewModel[] = [];
    parts.forEach((part, index) => {
        const expanded = expandPathPart(part, firstIsRoot && index === 0 && segments.length === 0);
        if (expanded) segments.push(...expanded);
    });
    return segments;
}

function parseReferenceSegments(reference: string): RuleReferenceSegmentViewModel[] | null {
    const trimmed = reference.trim();
    if (!trimmed) return null;
    const parts = splitTopLevelPath(trimmed);
    if (!parts.length) return null;
    const segments: RuleReferenceSegmentViewModel[] = [];
    for (let index = 0; index < parts.length; index += 1) {
        const expanded = expandPathPart(parts[index], index === 0 && segments.length === 0);
        if (!expanded?.length) return null;
        segments.push(...expanded);
    }
    return segments.length ? segments : null;
}

function splitTopLevelPath(text: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let quoteOpen = false;
    let hashFence = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const prev = index > 0 ? text[index - 1] : '';
        if (char === '"' && prev !== '\\') quoteOpen = !quoteOpen;
        if (!quoteOpen && char === '#') hashFence = !hashFence;
        if (quoteOpen || hashFence) continue;
        if (char === '(') parenDepth += 1;
        else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (char === '[') bracketDepth += 1;
        else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (char === '{') braceDepth += 1;
        else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (char === '.' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            parts.push(text.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(text.slice(start).trim());
    return parts.filter(Boolean);
}

function expandPathPart(part: string, isRoot: boolean): RuleReferenceSegmentViewModel[] | null {
    const trimmed = part.trim();
    if (!trimmed) return null;
    const segments: RuleReferenceSegmentViewModel[] = [];
    let cursor = 0;

    const localizedMatch = trimmed.match(/^\(([A-Za-z0-9_-]+)\)([A-Za-z_][A-Za-z0-9_:]*)$/);
    if (localizedMatch) {
        segments.push({
            raw: `(${localizedMatch[1]})`,
            display: localizedMatch[1],
            kind: 'qualifier'
        });
        segments.push({
            raw: localizedMatch[2],
            display: formatReferenceSegmentLabel(localizedMatch[2], classifyReferenceSegment(localizedMatch[2])),
            kind: classifyReferenceSegment(localizedMatch[2])
        });
        return segments;
    }

    const baseMatch = trimmed.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_:]*/);
    if (baseMatch) {
        const base = baseMatch[0];
        cursor += base.length;
        const openParenIndex = cursor < trimmed.length && trimmed[cursor] === '(' ? cursor : -1;
        if (openParenIndex > -1) {
            const call = extractBalancedSegment(trimmed, openParenIndex, '(', ')');
            if (!call) return null;
            segments.push({
                raw: `${base}(${call.inner})`,
                display: `${formatFunctionDisplay(base)}()`,
                kind: 'method'
            });
            cursor = call.endIndex + 1;
        } else {
            segments.push({
                raw: base,
                display: formatReferenceSegmentLabel(base, isRoot ? 'root' : classifyReferenceSegment(base)),
                kind: isRoot ? 'root' : classifyReferenceSegment(base)
            });
        }
    }

    while (cursor < trimmed.length) {
        if (trimmed[cursor] !== '[') return null;
        const bracket = extractBalancedSegment(trimmed, cursor, '[', ']');
        if (!bracket) return null;
        const content = bracket.inner.trim();
        segments.push({
            raw: `[${content}]`,
            display: formatBracketSegmentLabel(content),
            kind: classifyBracketSegment(content)
        });
        cursor = bracket.endIndex + 1;
    }

    return segments.length ? segments : null;
}

function classifyReferenceSegment(token: string): RuleReferenceSegmentKind {
    const normalized = token.trim().toLowerCase();
    if (['value', 'previousvalue', 'code', 'userid'].includes(normalized)) return 'qualifier';
    return 'field';
}

function classifyBracketSegment(content: string): RuleReferenceSegmentKind {
    if (/^\d+$/.test(content)) return 'index';
    return 'filter';
}

function formatReferenceSegmentLabel(token: string, kind: RuleReferenceSegmentKind): string {
    const normalized = token.trim().toLowerCase();
    if (normalized === 'value') return 'Current Value';
    if (normalized === 'previousvalue') return 'Previous Value';
    if (normalized === 'code') return 'Code';
    if (normalized === 'userid') return 'User ID';
    if (kind === 'method') return `${formatFunctionDisplay(token)}()`;
    return formatTokenDisplay(token);
}

function formatBracketSegmentLabel(content: string): string {
    if (/^\d+$/.test(content)) return `[${content}]`;
    const trimmed = content.trim();
    if (trimmed.startsWith('#') && trimmed.endsWith('#')) {
        const predicate = splitTopLevelRelational(trimmed.slice(1, -1));
        if (predicate) {
            const field = formatReferenceDisplay(predicate.left);
            const operator = formatComparisonOperatorLabel(predicate.operator);
            const value = stripWrappingQuotes(predicate.right);
            return `where ${field} ${operator} ${value}`;
        }
        return 'where filter';
    }
    return 'Filtered Item';
}

function isValidReferenceSuffix(text: string): boolean {
    return /^(\[[^\]]+\]|\.(\([A-Za-z0-9_-]+\))?[A-Za-z_][A-Za-z0-9_:]*)+$/.test(text);
}

export function formatReferenceDisplay(reference: string): string {
    const segments = parseReferenceSegments(reference);
    if (segments?.length) return buildReferenceDisplay(segments);
    return reference
        .split('.')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => formatTokenDisplay(part))
        .join('.');
}

function formatTokenDisplay(token: string): string {
    const raw = token.trim();
    if (!raw) return raw;
    return raw
        .replace(/^go_mdf:/i, '')
        .replace(/^core_java:/i, '')
        .replace(/Model$/, ' Model')
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .replace(/^./, match => match.toUpperCase());
}

export {
    buildReferenceDisplay,
    formatFunctionDisplay,
    formatMethodDisplay
};
