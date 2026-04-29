# Instance Explorer Design System

> Brand & component reference for **SuccessFactors Instance Explorer** — internal architect tool that loads SAP SuccessFactors tenant exports and lets consultants browse, graph, compare, and audit their content.
>
> The visual design is implemented in `ui/style.css` and `ui/design-tokens.css`. Fonts ship in `ui/public/fonts/`. The logo ships in `ui/public/logo-mark.svg`.

## What this tool is

Light-on-dark-shell desktop web app built with Vite + UI5 Web Components. Reads exported tenant artifacts (Object Definitions zip, RBP CSVs, business-rule dumps, OData metadata, workflows) and renders them across six workspaces:

| Workspace | Purpose |
| --- | --- |
| **Overview** | Module-level dashboard, drill into a module to see a Blueprint |
| **Graph** | Force / ELK layouts of the four entity types — `MDF_OBJECT`, `BUSINESS_RULE`, `RBP_ROLE`, `ODATA_ENTITY`. Three view kinds: Suite / Blueprint / Drilldown |
| **RBP Flow** | Permission-flow diagram |
| **Explore** | Searchable, faceted list of every entity (Objects, Rules, Roles, OData, Workflows) with deep-search across fields & permissions |
| **ROFP Matrix** | Role × Object × Field × Permission grid — flag Super Roles, Orphan Objects |
| **Compare** | Two-instance side-by-side mode (every workspace can run split) |
| **Import** | Drop-zone form for the export bundle, project switcher |

The user is an SAP SuccessFactors consultant or architect debugging tenant configuration. They live in the right-hand inspector panel, opening rules and objects and checking what's wired to what.

## Brand DNA

- **It is SAP Fiori, but lighter and softer.** The shellbar at the top is dark Horizon (`#0a1628`), but every workspace below is a light-on-light glassy surface — soft blue radial halos behind translucent white panels.
- **One brand color: SAP blue (`#0b6cf2`)** carries every active state. The other entity colors (amber rules, red roles, teal OData) are reserved for *content*, not chrome.
- **Type is SAP "72"** — the official Fiori sans, shipped self-hosted in `ui/public/fonts/`.
- **Corner radii are bigger than Fiori default** (18–28 px on panels, fully round on pills) — the signature softer-than-Fiori feel.
- **Density is high.** Tables, lists, inspectors all assume a power user reading dense data, not a casual marketing visitor.

## Content fundamentals

- **Tone is consultant-to-consultant.** Plain, declarative, mildly technical. No exclamation points, no hype words ("amazing", "powerful"), no second-person marketing voice.
- **Direct, imperative instructions** when telling the user to do something:
  - *"Choose a module or open Explore"*
  - *"Pick a role from the list to see a readable permission map"*
  - *"Drop `.zip` here or browse"*
  - *"Use the Compare tab to load two projects side by side."*
- **Capitalization:** sentence case for everything — buttons, headings, sub-views, modals. Acronyms stay shouty (`RBP`, `MDF`, `OData`, `ROFP`, `WF`). Entity types are SHOUTY_SNAKE_CASE in code (`MDF_OBJECT`) but **Title Case in UI** ("Object", "Business Rule", "RBP Role").
- **Pronouns:** **second-person *your*** for the user's data ("your instance", "your export") — never "I" or "we". Tool-as-narrator is rare; mostly the UI just describes what's there.
- **Empty states** are short and tell you what to do next, not what failed:
  - *"Workflow definitions will appear here."*
  - *"Upload RBP permission CSV files in Import to populate the matrix."*
  - *"Select a view above to browse entities."*
- **Diagnostic messages** name the thing precisely. Confidence-strip copy: *"Medium parse confidence: some actions are partially classified. Use the technical toggles or raw rule text to verify edge cases."*
- **Microcopy patterns:**
  - **Eyebrows** above big titles — uppercase, tracked-out, accent blue: *"ARCHITECT VIEW"*, *"ROLES VIEW"*.
  - **Counts inline** with `·` separators: *"3 branches · 5 conditions · 2 actions"*.
  - **Action verbs on chips:** *"Show role permission links"*, *"Show hidden low-signal nodes"*, *"Reset layout"* — tell the chip what it does, no icons-only.
  - **Tooltips explain *why*** something is off by default.
- **Numbers everywhere.** Counts, scores, complexity indicators (e.g. `★ 1434`) are first-class — the audience wants metrics, not narrative.
- **No emoji** in chrome. The only glyphs are `✕` for close, `▾`/`▸` for expand, and the occasional `📦` / `📁` on import drop-zones.
- **No filler.** Sections are introduced with a single sentence at most, then the tool gets out of the way.

## Visual foundations

### Color
- **One brand blue** (`--accent: #0b6cf2`) carries every interactive state — tab bar active fill, focus rings, hovers (with `rgba(11,108,242,0.12)` softs), summary badges.
- **Four entity colors**, used consistently across graph nodes, legend dots, badges, matrix cells, sub-view pills:
  - MDF Object → blue (same as `--accent`)
  - Business Rule → amber `#d97706`
  - RBP Role → red `#be3b2b`
  - OData Entity → teal `#0c8cab`
- **Module palette** (Employee Central, Recruiting, Learning, Compensation, etc.) — 13 distinct hues defined in `--mod-*`. Used for module clusters in Suite view; never for chrome.
- **No dark mode.** The app shell is dark, but the workspace itself is permanently light.

### Type
- **SAP 72** for all text (regular 400, light 300, bold 700; 500 + 600 are synthesized — flagged for replacement).
- Mono fallback (SFMono / Consolas / Menlo) for rule expressions, IDs, raw exports.
- Scale starts at **11 px** (`--fs-2xs`, used for eyebrows / sublabels) and tops out at a fluid hero (`clamp(1.8rem, 3vw, 2.5rem)`).
- **Eyebrows** are the most distinctive type pattern: 11 px, `letter-spacing: 0.14em`, uppercase, accent blue.

### Spacing
- 4 / 8 / 12 / 16 / 24 / 32 / 40 px scale (`--sp-xs` → `--sp-3xl`).
- Inspector and panels favor `var(--sp-md)` (12 px) gaps inside, `var(--sp-lg)` (16 px) padding outside.

### Backgrounds
- **Page bg is composed:** a `radial-gradient` blue halo at top-left + a vertical white→cool-grey linear. Always two stacked, never a solid.
- **Panel bg is "glass":** white with 86–96 % opacity, optional teal radial halo top-right, plus `backdrop-filter: blur(12px)` (`--blur-panel`).
- No images, no textures, no hand-drawn illustrations, no patterns.

### Borders
- `1 px solid var(--border)` (`#d8e0eb`) — every card, panel, table row.
- Branch indicators use a **4 px colored left-edge stripe**, not a full border.
- Buttons are border-less; chips and tabs use full-round (`--radius-full: 999px`).

### Shadows
- Five tiers: subtle (`0 4px 14px rgba(9,26,56,0.06)`), card, hover, panel (`0 18px 40px rgba(9,26,56,0.08)`), drop. **All shadows are cool blue-tinted, not neutral grey.** No inner shadows.

### Corner radii
- 8 / 14 / 18 / 24 / 28 px (`--radius-sm` → `--radius-2xl`), plus full-round.
- Big radii on panels and hero cards (18+) are the system's signature.

### Animation & interaction
- Three durations: `--dur-fast` 0.12 s, `--dur-base` 0.18 s, `--dur-slow` 0.28 s.
- Easing is just `ease` / `ease-out` — no bouncy springs, no parallax.
- **Hover state:** shift to `var(--surface-hover)` (`rgba(11,108,242,0.06)`) on lists; darken accent on buttons. No scale, no shadow lift.
- **Press / active state:** solid `--accent` fill, white text. Buttons don't shrink.
- **Focus:** native UI5 outline; we don't override it.

### Layout rules
- Sticky shellbar (48 px) + workspace switcher (~52 px) + workspace content fills the rest.
- Inspector panel is right-side, fixed-width (`min(390px, 34vw)`) — designs must work at **390 px**.
- Compare mode = vertical split, both panes share toolbar.

## Iconography

- **SAP UI5 icon font** is the source of truth. The font file (`SAP-icons.woff2`) ships in `ui/public/fonts/`; in the running app it's loaded by `@ui5/webcomponents-icons` and surfaced via `<ui5-button icon="…">`, `<ui5-li icon="…">`.
- Common icons used in the app: `decision`, `business-objects-experience`, `role`, `connected`, `workflow-tasks`, `zoom-in`, `zoom-out`, `refresh`, `hide`, `menu2`, `copy`, `full-screen`. Full set: <https://sdk.openui5.org/test-resources/sap/m/demokit/iconExplorer/webapp/index.html>.
- **Unicode glyphs** used as bare icons: `✕` (close), `▾`/`▸` (expand), `→` (action arrow), `Δ` (delta), `⊕` / `⊖` (add/remove association), `🔒` (permission guard), `★` (complexity score), `›` (breadcrumb separator).
- **No PNG icons. No icon library substitution** — the app is opinionated about UI5 icons because they ship pre-paired with the components.

## Token reference (where it lives)

| Need | Open |
| --- | --- |
| Color, font, spacing, radius, shadow tokens | `ui/design-tokens.css` |
| Component CSS (rule logic v2, panels, branches, tokens) | `ui/style.css` (`.rule-tok--*`, `.rule-connector`, `.rule-v2-*` classes) |
| Self-hosted SAP 72 + UI5 icons font | `ui/public/fonts/` |
| Brand mark | `ui/public/logo-mark.svg` |
| Rule logic v2 design intent and acceptance criteria | `docs/RULE_LOGIC_DESIGN_BRIEF.md` |

## Caveats

- **SAP 72 weights 500 / 600 are synthesized** from Regular — SAP doesn't expose them publicly. If you have access to the official UI5 package, drop `72-SemiBold.woff2` and `72-Italic.woff2` into `ui/public/fonts/` and add matching `@font-face` blocks in `ui/design-tokens.css`.
- The rule-logic v2 redesign targets the existing `RuleSemanticModel` shape in `ui/lib/rules/semantic.ts` — the parser stays untouched. The renderer is `ui/lib/rules/render.ts`.
