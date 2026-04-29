# Compact Rule Logic Visualization — Design Brief

> **Audience:** Visual design implementation.
> **Goal:** Replace the current rule-logic inspector view (`ui/lib/rules/render.ts`) with a compact, SAP-Fiori-native sentence-flow layout that fits a typical rule above the fold without zooming out, while degrading gracefully on the long-tail of complex rules (up to 26 branches, 2,000+ char lines).
> **Mode:** Single view with progressive disclosure — no separate "diagram" or "split" mode.
> **Constraint:** The semantic model in `ui/lib/rules/semantic.ts` is fixed. Design against `RuleSemanticModel` (signature, variables, branches, summary). All visual changes happen in the renderer + CSS.

## 1. Reference inputs

| File | What to use it for |
| --- | --- |
| `ui/lib/rules/semantic.ts` | Type contract for everything the design must render. |
| `docs/RULE_LOGIC_ANALYSIS.md` | Real DSL snippets per pattern. Treat as ground truth for edge cases. |
| `ui/lib/rules/render.ts` | Current renderer (what we are replacing). |
| `ui/style.css` (lines 2878-3540) | Current `rule-*` classes; some can be retained. |
| Screenshot 1 (SAP native) | Inspiration for sentence-flow density and inline action rows. |
| Screenshot 2 (current app) | What we are explicitly fixing — too many vertical cards. |

## 2. Design principles

1. **Sentence flow, not card stack.** Each condition and action is a one-line phrase. Cards are only used at the rule-wrapper level.
2. **Progressive disclosure.** First render = a 1-line gist per branch. Click to expand to full conditions/actions. Expand again on a single action to see technical detail / nested args.
3. **Density first.** Median rule (3 branches, 2 conditions, 2 actions) must fit in the inspector viewport (~640 px tall, ~480 px wide) without scrolling.
4. **Token typography over boxes.** Field references, literals, function calls, and operators are inline tokens with semantic color, not rows in a 3-column grid.
5. **Pattern-aware.** Detect the 12 patterns from the analysis report (delta-checks, permission guards, lookups, association ops, etc.) and render them with purpose-built compact phrasings.
6. **Raw escape hatch.** Every block keeps a "view raw" affordance. Parser-stress cases skip the semantic view entirely and show the formatted raw text.
7. **Fiori native.** Lean on `@ui5/webcomponents` primitives so the rule view inherits the app's existing typography ("72" font), spacing tokens, and theming.

## 3. Component palette (UI5 web components + custom)

| Region | Primary component | Notes |
| --- | --- | --- |
| Outer wrapper | `<section class="rule-logic-v2">` | Plain section, not a `ui5-card`. |
| Rule header bar | `ui5-bar` (design="Header") + `ui5-tag` chips | Compact 1-row title + meta. |
| Parameter table | `ui5-table` (mode=None, sticky-column-header) | 3 cols: Name · Object · Access. |
| Variables strip | `ui5-list` mode=None with `ui5-li-custom` | One row per variable, inline `name := source`. |
| Branch list | Custom `<ol class="rule-branches">` with `<li>` per branch | NOT `ui5-tree` — too verbose for this density. Use semantic list. |
| Branch header (collapsed) | `<button>` with role=summary + chevron | Single line: kind tag + 1-sentence gist + counts. |
| Condition row | `<div class="rule-clause">` with inline tokens | Sentence: `[Left token] [op word] [Right token]`. |
| Connector | `<span class="rule-connector">AND</span>` / `OR` | Inline uppercase, never on its own line. |
| Action row | `<div class="rule-act">` with inline tokens | Sentence: `Set [field] to [value]`. |
| Field reference token | `<span class="rule-tok rule-tok--ref">` | Blue chip; tooltip shows full technical path. |
| Literal token | `<span class="rule-tok rule-tok--lit-{string\|num\|bool\|null}">` | Color-coded by type. |
| Function token | `<span class="rule-tok rule-tok--fn">` | Purple chip with descriptor label (`Lookup`, `Round`, etc.). Click opens popover. |
| Permission guard chip | `<span class="rule-tok rule-tok--perm">` 🔒 | Hoisted above the branch's "When" line. |
| Delta indicator | `<span class="rule-tok rule-tok--delta">Δ</span>` | Replaces the verbose `unliteral(x.previousValue) != x.value` pattern. |
| Action popover | `ui5-popover` | Lazy-mounted on expand; carries technical detail. |
| Raw view | `<details class="rule-raw"><pre>` | Same as today; reuse `formatRuleBody()`. |
| Parse confidence | `ui5-message-strip` design=Information/Negative | Reuse current `renderConfidenceStrip()`. |

**Avoid:** `ui5-panel` per section (too thick), `ui5-tree` (chevron column wastes space), `ui5-card` per action (the whole reason the current view is too tall).

## 4. Top-to-bottom layout

~~~text
┌─ rule-logic-v2 ──────────────────────────────────────────────┐
│ ┌─ rule-head-bar ──────────────────────────────────────────┐ │  ~36 px
│ │ ARS_CHANGE_HOME_WF      _basic · homeAddressModel · ★1434│ │
│ │                          [⋮ Copy raw] [⤢ Expand all]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ rule-parse-strip (only if confidence < high) ────────────┐│
│ │ ⓘ Medium parse confidence — some actions partial          ││
│ └───────────────────────────────────────────────────────────┘│
│ ┌─ rule-params-table (collapsed by default if N > 3) ───────┐│  ~28 px header
│ │ Name              Object              Access              ││ + N×24 px rows
│ │ Context           SystemContext       Read-only           ││
│ │ Address Model     homeAddressModel    Full                ││
│ └───────────────────────────────────────────────────────────┘│
│ ┌─ rule-vars-strip (collapsed by default if N > 0) ─────────┐│  ~24 px collapsed
│ │ ▾ Variables · 2                                            ││  N×26 px expanded
│ │   Seniority       := Difference In Calendar Years          ││
│ │   Amount          := Lookup VACACIONES_BRA                 ││
│ └───────────────────────────────────────────────────────────┘│
│ ┌─ rule-branches (the main canvas) ─────────────────────────┐│
│ │ ▾ IF · 13 conditions · 1 action  🔒 EC-GRH-RRHH            ││
│ │     When  Address.City changed Δ                           ││
│ │       OR  Address.Address1 changed Δ                       ││
│ │       OR  Address.Address2 changed Δ                       ││
│ │           …and 10 more                                     ││
│ │     Then  Set wfConfig to "WF_ALTA_RECONTRATACION_EXT_FC"  ││
│ │ ▸ ELSE IF · 12 conditions · 1 action                       ││
│ │ ▸ ELSE · 0 actions                                         ││
│ └───────────────────────────────────────────────────────────┘│
│ ▸ View raw rule text                                          │
└──────────────────────────────────────────────────────────────┘
~~~

## 5. Element-by-element rendering rules

### 5.1 Rule header bar (`renderHeader(model, node)`)

- Single horizontal `ui5-bar` (no nested grid).
- Left: rule name as `ui5-title level=H4`.
- Middle: three `ui5-tag` chips — scenario, base object, complexity (★ + score from analysis report if available; otherwise `model.summary.branchCount` branches).
- Right: `ui5-button design=Transparent icon="copy"` (raw rule text), `ui5-button design=Transparent icon="full-screen"` (toggle expand-all-branches).

### 5.2 Parse confidence strip

- Reuse the existing `renderConfidenceStrip()` exactly. Only render when `model.summary.parseConfidence !== 'high'`. Already minimal.

### 5.3 Parameters

- Render as `ui5-table` (3 cols, no card wrapper). Auto-collapse to a one-line `ui5-token`-style summary when `model.signature.parameters.length > 3` and put the table inside a `<details>`.
- Columns map to `RuleParameterViewModel`: `displayName` → Name, `objectType` → Object, `accessHint` → Access.
- Tooltip on the Name cell shows `technicalName` and `technicalType`.

### 5.4 Variables strip

- Always inside a `<details class="rule-vars">`, **closed by default**. Summary: `Variables · {model.variables.length}`.
- Each variable row: `<div class="rule-var-row"><span class="rule-tok rule-tok--var">{displayName}</span><span class="rule-assign">:=</span>{renderExpressionInline(sourceExpression)}</div>`.
- Hover on a row reveals `usedBy` items as a `ui5-popover` (`Used in: Set ...; Create ...`).

### 5.5 Branch list (the main canvas)

For each `RuleBranchViewModel`:

- One `<li class="rule-branch rule-branch--{type}">` with a left-edge colored stripe (4 px):
  - `if`: green (`var(--accent)`)
  - `elseif`: blue
  - `else`: gray
  - `statement`: gray
- **Collapsed state (default for branches 2+, expanded for branch 1):**
  - Header row only (`<button class="rule-branch-head">`):
    - Chevron `▸` / `▾`
    - Kind chip (`IF` / `ELSE IF` / `ELSE` / `STATEMENT`)
    - Counts: `· {N} condition{s} · {M} action{s}`
    - Permission badges (see §5.9) hoisted here so guards are visible without expanding.
    - One-line "gist": the dominant comparison (heuristic: longest `kind === 'comparison'` condition, render with `renderClauseInline()` + ellipsis at 80 chars), or the action summary if `branch.conditions.length === 0`.
- **Expanded state:** show `When …` and `Then …` blocks as paragraph-style content (no inner cards):
  - **When block:** `<div class="rule-when"><span class="rule-zone-label">When</span>` + condition rows (see §5.6).
  - **Then block:** `<div class="rule-then"><span class="rule-zone-label">Then</span>` + action rows (see §5.7). For `branch.type === 'statement'`, label is `Do` and there is no `When` block.

### 5.6 Condition row

For each `RuleConditionViewModel`:

- Always inline (no card). Class: `rule-clause rule-clause--{kind}`.
- `kind === 'comparison'`:
  - `[Left token] [op word] [Right token]`
  - Operator uses `formatComparisonOperatorLabel()` already in `semantic.ts` (e.g., `is not equal to`, `is greater than`).
  - Render in italic muted gray; the surrounding tokens carry the visual weight.
- `kind === 'always_true'`: render `<em class="rule-always">Always runs</em>` only — collapse the entire When block to this line.
- `kind === 'expression'`: inline render of `expression`.
- `kind === 'raw'`: show first 80 chars + ellipsis; click opens raw popover.
- **Connector handling:** `connectorToNext` becomes a *trailing* inline pill at the end of the row: `<span class="rule-connector">AND</span>` / `OR`. The next row visually starts indented to imply the join.
- **Compaction trigger:** if a branch has `> 5` conditions, render the first 3, then `<button class="rule-more">…and N more</button>` that expands inline to reveal the rest.

### 5.7 Action row

For each `RuleActionViewModel`:

- Always inline. Class: `rule-act rule-act--{type}`.
- Left edge: 2 px colored bar matching action type (assignment=blue, lookup=teal, create=green, method=violet, raw=red).
- Sentence templates:

| `action.type` | Sentence template |
| --- | --- |
| `assignment` | `Set {targetExpression} to {value}` |
| `lookup_assignment` | `Set {targetExpression} from lookup {lookupSource} → {selectField}` (predicate count badge: `{predicates.length} where`) |
| `create_record` | `Create {targetObjectDisplay}{associationName ? ' (' + associationName + ')' : ''}` (field count badge: `{fields.length} fields`) |
| `method_call` | `{calleeExpression}.{methodDisplay}({args.length} args)` |
| `raw` | First 80 chars of `summary` + ellipsis |

- The trailing badge on `lookup_assignment` / `create_record` / `method_call` is a `ui5-button design=Transparent` that opens a `ui5-popover` with the full breakdown:
  - `lookup_assignment` popover: predicate table (`field`, `operator`, `value`).
  - `create_record` popover: 2-col field table (`displayName`, inline `value`).
  - `method_call` popover: argument list (`label`, inline `value`).
- Below every action row is a one-line `<details class="rule-tech">` with `Technical action` summary and the `raw` text — reuse the existing `renderTechnicalToggle()`.

### 5.8 Expression rendering (`renderExpressionInline`)

The existing `renderExpression(_, density='full')` is too vertical. Replace with **always-inline** rendering:

- `kind === 'literal'`:
  - `string` → `<span class="rule-tok rule-tok--lit-string">"{display}"</span>` (orange, monospace, max 40 chars then ellipsis).
  - `number` → `<span class="rule-tok rule-tok--lit-num">{display}</span>` (slate, monospace).
  - `boolean` → green/red filled pill.
  - `null` → muted "Null" pill.
- `kind === 'reference'`:
  - Render `referencePath` as breadcrumb chips joined by `›`.
  - **Smart-truncate** at 3 segments: show `root › … › last`, full path on hover.
  - Each segment color-coded by `kind`: root=indigo, field=blue, qualifier=teal, method=violet, index=gray, filter=amber.
- `kind === 'function'`:
  - `<button class="rule-tok rule-tok--fn">{functionLabel}</button>` (descriptor label from `FUNCTION_DESCRIPTORS` already in `semantic.ts`).
  - Click opens `ui5-popover` with subject path, named args, trail path, and `functionPurpose` as a one-line caption.
  - Never inline-expand functions — they always live behind a popover.
- `kind === 'raw'`:
  - First 60 chars + ellipsis; click opens raw popover.

### 5.9 Pattern-aware enhancements (read these from `RULE_LOGIC_ANALYSIS.md`)

The analyzer detects 12 recurring patterns. The renderer should detect a subset cheaply (regex/structure on `RuleConditionViewModel.raw` and `RuleActionViewModel.raw`) and render them more compactly:

| Pattern | Visual treatment |
| --- | --- |
| **Deep Branching** (>10 branches, e.g. ARS_CHANGE_HOME_WF, AR_WF_HIRE_REHIRE II 26 branches) | Auto-collapse all branches except the first. Show "Showing 1 of {N} branches · expand all" affordance in header bar. |
| **Compound Conditions** (4+ booleans, up to 127 comparisons) | Group consecutive same-connector conditions visually (left-rail color band). Apply §5.6 "more than 5 → show first 3 + expand." |
| **Variable Staging** (`accrualRuleVariables.x = …`) | Already covered by the Variables strip (§5.4). Detect via `target` starting with `accrualRuleVariables` / `ruleVariables` (logic exists in `semantic.ts:803`). |
| **Lookup Predicates** | `Set X from lookup VACACIONES_BRA → Amount` + `3 where` badge → popover with predicate table. |
| **Association Creation** (`addAssociation(...new(...))`, type=`create_record`) | Green ⊕ icon + "Create record in {associationName}" + popover with field map. |
| **Association Removal** (`removeAssociation(...)`, currently parsed as `method_call` with method=`removeAssociation`) | Red ⊖ icon + "Remove record from {associationName}" + popover with the matched filter. |
| **Previous Value / Delta Logic** (`unliteral(x.previousValue) != x.value`) | Detect this exact 2-sided pattern in a comparison; collapse to a single chip: `{Field} changed Δ`. Strips out 80%+ of the visual noise on rules like ARS_CHANGE_HOME_WF. |
| **Pay Scale Calculations** (`getPayScaleAmount`, `getPayScaleCurrency`, `getPayScaleFrequency`, `toPayScalePayComponents`) | Money icon ($) on the function token; popover header reads "Pay Scale". |
| **Filtered/Indexed Collections** (`coll(#field == "x"#)[0].field`) | Render filter segment as italic dotted chip: `{Collection}[where pay_component = "002R"][0].paycompvalue`. |
| **Permission Group Checks** (`isUserInPermissionGroup(...)`) | Detect at branch parse time and **hoist** to the branch header as a 🔒 chip with the group name. Removes the largest source of visual noise from branchy workflow rules (ARS_CHANGE_HOME_WF, AR_WF_HIRE_REHIRE). |
| **Long Nested Formulas** (line >800 chars or paren depth ≥4) | Suppress inline expansion of the function tree; show only the top-level function token + a `View formula` button that opens a `ui5-popover` containing a syntax-highlighted code block (reuse `formatRuleBody()`). Hard cap on inline content: 200 chars per token. |
| **Parser Stress / Raw Fallback** (unbalanced delimiters, raw-like statement count >0) | Replace the entire `rule-branches` canvas with a single `ui5-message-strip design=Negative` ("Heuristics could not classify this rule fully") and the formatted raw block. |

## 6. Density & overflow rules

- **Hard cap:** any inline token > 60 chars → ellipsize and put full content in a `title` attribute.
- **Hard cap:** any inline literal-string > 40 chars → ellipsize.
- **Branch overflow:** > 10 branches → collapse all but the first.
- **Condition overflow:** > 5 conditions in a branch → show first 3 + "more" expander.
- **Action overflow:** > 5 actions in a branch → show first 3 + "more" expander.
- **Parameter overflow:** > 3 params → collapse table into `<details>`.
- **Long formulas:** any expression with `args.length > 4` or any nested function depth > 2 → only render the top-level descriptor + popover.
- **Inspector width:** the layout must work down to **400 px** (project's `--inspector-width: min(390px, 34vw)`). Test the design at 400 px and at 1200 px (desktop full-width).

## 7. Visual language (reuse `ui/design-tokens.css`)

| Element | Color token | Typography |
| --- | --- | --- |
| Field reference chip | `--accent` (blue) bg @ 10% | font-weight 500, font-family "72" |
| Literal — string | amber bg @ 10%, amber-700 text | monospace |
| Literal — number | slate bg @ 8%, slate-700 text | monospace |
| Literal — boolean true | green-600 filled | weight 600 |
| Literal — boolean false | red-600 filled | weight 600 |
| Function chip | violet-600 bg @ 12% | weight 500 |
| Permission chip | green-700 bg @ 12% with 🔒 prefix | weight 500 |
| Delta chip Δ | orange-600 bg @ 15% | weight 600, italic |
| Connector AND | gray-500 text, uppercase, font-size 11 px |
| Connector OR | gold-600 text, uppercase, font-size 11 px |
| Branch stripe `if` | `var(--accent)` (4 px) |
| Branch stripe `elseif` | indigo-500 (4 px) |
| Branch stripe `else` / `statement` | gray-400 (4 px) |
| Operator word | gray-600 italic |
| Section/zone label | uppercase tracking-wide gray-500, font-size 10 px |

**Spacing:** every row uses `padding: 4px 8px`, branch container `padding: 8px 12px`, stripe is `inset-block: 4px; inset-inline-start: 0;` 4 px wide. Total per-action-row height target: **24 px** (down from ~120 px today).

## 8. Interaction & accessibility

- Branch headers are real `<button>` elements with `aria-expanded`, `aria-controls`.
- Token popovers open on `click` (not hover) so they are keyboard-accessible — `Enter` / `Space` triggers.
- Function chips have `role="button"` and `aria-haspopup="dialog"`.
- Delta chip (Δ) has an `aria-label="Field changed"`.
- Permission chip has `aria-label="Branch guarded by permission group {name}"`.
- All color carries a non-color signal (chevron for expand, prefix glyph for delta/permission).
- The view must keep `-webkit-overflow-scrolling: touch` on the outer wrapper for trackpad scroll on macOS.

## 9. Acceptance criteria

A rule renders with the new design if and only if **all** the following hold:

1. The "median" rule (3 branches × 2 conditions × 2 actions, no nested formulas) fits within a 400 × 640 viewport without scrolling, all branches expanded.
2. ARS_CHANGE_HOME_WF (13 branches, 127 comparisons, score 1434) fits within 400 × 640 with all branches collapsed and is fully navigable from there.
3. AR_WF_HIRE_REHIRE II (26 branches, 174 comparisons, line max 2,119 chars) renders without horizontal scroll and without freezing the inspector — long formulas live behind popovers, never inline.
4. EC_Validacion_Cuenta_Bancaria (parser-stress: paren delta +3) shows the negative parse strip + raw view, never the broken semantic view.
5. Total DOM nodes for the median rule are **< 120** (current renderer: 350-450).
6. No element exceeds 60 chars without an ellipsis + title attribute.
7. All interactive elements reachable via keyboard.
8. Color contrast meets WCAG AA against the app's light theme.

## 10. Out of scope (do NOT redesign in this brief)

- The semantic parser in `semantic.ts` — keep `RuleSemanticModel` shapes intact. Two optional helper additions (delta-pattern detector, permission-check extractor) would let the renderer be cheaper, but the renderer can also detect them itself with regex on `raw`.
- The "View raw rule text" details block — already correct; reuse `formatRuleBody()`.
- The "Copy to clipboard" affordance — reuse `renderCopyControl()`.
- Inspector-level wrappers (`renderRuleSections`, the surrounding scroll container, the close button).

## 11. Mapping summary (renderer rewrite delta)

| Old (`render.ts`) | New |
| --- | --- |
| `renderContextSection` (cards grid + tokens) | `renderHeader` (1-row bar) + `renderParamsTable` (3-col `ui5-table`) |
| `renderVariablesSection` (card grid) | `renderVarsStrip` (`<details>` + 1-line rows) |
| `renderStorySection` → `renderBranch` (article + zones) | `renderBranches` (semantic `<ol>`, collapsed by default) |
| `renderConditionCard` (3-col left/op/right) | `renderClauseInline` (single inline sentence) |
| `renderActionCard` (article per type, 5 templates) | `renderActionInline` (sentence per type, 5 templates, popovers for detail) |
| `renderExpression(density='full')` (recursive surfaces) | `renderExpressionInline` (always inline; functions go to popover) |
| `renderTechnicalToggle` | unchanged — reuse |
| `renderConfidenceStrip` | unchanged — reuse |
| Class names `rule-story-card*`, `rule-action-flow`, `rule-condition-sides`, `rule-expression-surface*` | retire; replace with `rule-clause`, `rule-act`, `rule-tok`, `rule-branch`, `rule-zone-label` |
