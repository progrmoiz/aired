# aired Design System

*Version 2.1 — 2026-11-25*

The single reference for building any UI in aired. Read before writing any component, page, or layout. Updated when patterns evolve.

**Stack:** pnpm monorepo. The site is vanilla HTML + JS (`apps/web/`): every page except the dashboard (homepage, pricing, guides, docs, claim, abuse, legal, 404) uses plain CSS in `apps/web/site.css`, with the tokens from `tailwind.config.js` as CSS variables. No page loads the Tailwind 3 build (`style.css`). The signed-in dashboard is a React + shadcn/ui (Base UI) + Tailwind v4 app in `apps/dashboard/`, built into `apps/web/` (§9.4).
**Icons:** Inline SVG, hand-picked. No library.
**Fonts:** Inter (400, 500, 600), JetBrains Mono (400, 500). Both self-hosted from `apps/web/fonts/` (latin variable woff2, OFL).
**Voice:** see §10 below
**Audience:** Anyone who made a page with an AI tool and needs to send it: agency people sending client reports, makers sharing a game, developers whose agent publishes. Also developer mid-task. Pasted HTML from Claude, ran a script, generated an artifact — they want a shareable URL right now, then leaving in 30 seconds. Indie hackers shipping prototypes are a superset of the same need.
**Brand keywords:** Instant. Trustworthy. Quiet.

**One surface:** every page uses the wide marketing layout (1120px `.wrap`, shared header and footer) so the site reads as one product people pay for. Reading pages (guides, docs) use 15px body in a 720px column. The dense 14px rules below still apply inside controls: form options, chips, captions. See §9.2 and §9.3.

---

## 1. Principles

Numbered, ordered by priority. When unsure, run the decision through these.

1. **Speed is the feature.** Anything that delays the URL — modal, signup, toast, animation — is wrong. The page exists to turn HTML into a link in seconds.
2. **Dense, not loud.** On tool pages body text is 14px and the max heading is 24px. Marketing pages may go to 15px body and a 44px H1, but stay quiet: no gradient text, no glow, no emoji.
3. **Quiet by default.** Neutrals carry the layout. The primary button is light (`text-primary` fill, `bg` text), not purple. Brand purple is the logo mark, focus rings and section eyebrows.
4. **States are not optional.** Every interactive element: default, hover, active, focus, disabled. Every async action: idle, pending, success, error.
5. **Strong defaults, no configuration.** TTL has a default. Visibility has a default. Pin is empty. The form should produce a URL with one click.

---

## 2. Design tokens: one source of truth

**`packages/ui-tokens/tokens.css` is the only place colour, type, radius, spacing, shadow and motion values are defined.** Everything else reads from it:

| Consumer | How it reads the tokens |
|---|---|
| Marketing site (`apps/web/site.css`) | `@import url("/tokens.css")`. `apps/web/tokens.css` is a synced copy made by `pnpm --filter @aired/ui-tokens sync`, which the Worker's `[build]` runs. Short aliases (`--bg`, `--text-1`, `--btn`…) point at `--aired-*`. |
| Dashboard (`apps/dashboard/src/index.css`) | `@import "@aired/ui-tokens/tokens.css"`. shadcn's variables (`--background`, `--primary`, `--ring`, `--radius-*`…) and Tailwind theme sizes (`text-body`, `text-heading`, `text-title`, `text-display`) point at `--aired-*`. |
| Guard | `apps/worker/test/tokens-sync.test.ts` fails if the copy drifts, or if either side stops mapping onto the tokens or puts a raw hex value in the dashboard theme. |

Token groups: surfaces (`--aired-bg`, `-surface`, `-surface-2`, `-popover`, `-sidebar`, `-code-bg`), lines and overlays (`-border`, `-border-strong`, `-hairline`, `-hairline-strong`, `-glow`, `-tint`), text (`-text-1/2/3`), actions and states (`-primary`, `-on-primary`, `-mark`, `-ring`, `-ok`, `-warn`, `-warn-bg`, `-danger`, `-chip-bg`, `-chip-text`, `-avatar-*`), type (`-font-sans`, `-font-mono`, `-text-xs` … `-text-display`), radius (`-radius-sm` 6 → `-radius-full`), spacing (`-space` 4px, `-page-max`, `-gutter`), shadow (`-shadow-glow`, `-shadow-pop`) and motion (`-ease`, `-dur-fast`, `-dur`).

**Palettes are token sets.** Dark is the default (`:root`). `:root[data-theme="warm"]` is a proposed light, warm set (Direction B): same names, new values, all text at WCAG AA. Setting `data-theme="warm"` on `<html>` re-skins the site and the dashboard together. Choosing it is a product decision; until then the site stays dark.

Illustration colours inside example artwork (the sample report, the code card) stay fixed on purpose: they depict a person's page, not aired.

## 2.1 Color Tokens (dark set)

Dark only. No light mode. All values come from `apps/web/tailwind.config.js` under `theme.extend.colors.aired`. Never hardcode hex in markup — use the token classes (`bg-aired-bg`, `text-aired-text-primary`, etc.).

```js
// Source of truth — apps/web/tailwind.config.js
aired: {
  bg:               '#0a0a0b',  // page background
  surface:          '#111113',  // cards, inputs, raised surfaces
  'surface-hover':  '#18181b',  // hover state on surfaces
  border:           '#222225',  // 1px outlines, dividers
  'border-focus':   '#3b3b40',  // focused input border
  'text-primary':   '#ededef',  // body, headings
  'text-secondary': '#a1a1a6',  // labels, captions (7.9:1 on bg)
  'text-tertiary':  '#84848a',  // placeholders, helper text (5.3:1 on bg)
  accent:           '#7c6aef',  // brand purple — see usage table below
  'accent-hover':   '#8b7bf2',  // hover state on primary action only
}
```

Status colors are not in the config (intentional — aired is mostly purple-or-neutral). When needed:

| Intent | Hex | Where it appears |
|--------|-----|------------------|
| Success | `#34d399` (emerald-400) | Copy button "copied" state, success toasts only |
| Error | inherit Tailwind `red-400` | Inline form errors only |

### Where the brand purple appears (exhaustive)

| Context | How |
|---------|-----|
| Logo mark | `#7c6aef` on the signal icon only |
| Section eyebrow (marketing pages) | 13px medium, `#7c6aef` |
| Focus ring (form-container glow) | `rgba(124, 106, 239, 0.4)` at 2px outside, on `:focus-visible` |
| Result URL link | `text-aired-accent` |
| Form-container ambient glow on focus-within | `0 0 40px -12px rgba(124, 106, 239, 0.08)` |

**Brand purple does NOT appear in:** hover backgrounds, body text, borders (except focus), icons, secondary buttons, kbd hints, install-card hover, links inside prose.

### 60-30-10

- 60% `--bg` and `--surface` (the page itself)
- 30% text in three tiers — primary, secondary, tertiary
- 10% purple — one primary action per visible section, one result link

---

## 3. Typography

### Font stack

Self-hosted in `apps/web/fonts/` (`fonts.css` has the `@font-face` rules). Every page's `<head>` has these two lines. Do not import via JS or `next/font` — this is a static HTML site. **Never link fonts.googleapis.com or fonts.gstatic.com**: the privacy policy promises no request to Google, and `apps/worker/test/asset-cache.test.ts` fails if a page does.

```html
<link rel="preload" href="/fonts/inter-latin-v20.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/fonts/fonts.css" />
```

A new font file needs a new versioned name (`-v<N>.woff2`): the Worker caches those for a year.

Tailwind classes:
- `font-sans` → Inter, then `-apple-system`, `BlinkMacSystemFont`, `sans-serif`
- `font-mono` → JetBrains Mono, then `SF Mono`, `Fira Code`, `monospace`

### Type scale

Lifted from `tailwind.config.js` — note that `base` is 14px, not the Tailwind default 16px. This is deliberate.

| Level | Size | Weight | Tailwind | Use |
|-------|------|--------|----------|-----|
| Hero / page title | 24px | Medium (500) | `text-xl font-medium tracking-tight` | The single H1 on a page |
| Section heading | 18px | Medium (500) | `text-lg font-medium` | Subhead, install-card title |
| Body | 14px | Regular (400) | `text-base` | Default UI text |
| Form label | 13px | Medium (500) | `text-sm font-medium text-aired-text-secondary` | Above every input |
| Caption / helper | 12px | Regular (400) | `text-xs text-aired-text-tertiary` | Helper text, timestamps |
| Micro / kbd | 11px | Regular (400) | `text-2xs` | Keyboard shortcuts, badges |

### Rules

- **Never `font-bold` or `font-semibold` (700+).** Headings are `font-medium` (500). Hierarchy comes from size and color, not weight.
- **Body is 14px.** This is a developer tool, not a marketing page. Don't bump to 16px.
- **Monospace for URLs, IDs, code, and CLI snippets only.** Never for headings.
- **Never use raw gray classes** (`text-gray-400`, etc.). Use `text-aired-text-{primary,secondary,tertiary}`.

---

## 4. Radius

Smaller than the modern shadcn default. aired's radius vocabulary is tighter — closer to a terminal than to iOS.

| Element | Radius | Tailwind |
|---------|--------|----------|
| Buttons, copy buttons | 8px | `rounded` (default) |
| Inputs, selects, textareas | 8px | `rounded` |
| kbd badges | 4px | `rounded-sm` minus 2px → use `[border-radius:4px]` or `rounded-sm` |
| Cards (form-container, install-card, result-card) | 12px | `rounded-lg` |

Defined in config: `sm: 6px`, `DEFAULT: 8px`, `lg: 12px`. Do not introduce `rounded-xl` or `rounded-2xl` — they don't exist in the scale.

---

## 5. Spacing

Tailwind default 4px base. Used generously between sections, tightly inside controls.

| Token | Value | Use |
|-------|-------|-----|
| 2 | 8px | Icon-to-text gaps inside buttons |
| 3 | 12px | Label-to-input gap |
| 4 | 16px | Inner padding (compact controls, kbd hints) |
| 6 | 24px | Standard card padding |
| 8 | 32px | Between form sections |
| 10–12 | 40–48px | Between major page sections (hero ↔ install ↔ footer) |

When the page feels long, remove elements — don't compress spacing.

---

## 6. Borders

Always 1px. 0.5px is forbidden (renders inconsistently across DPRs).

| Context | Value |
|---------|-------|
| Card outlines (form, install, result) | `border border-aired-border` |
| Input borders | `border border-aired-border` |
| Input focus | `border-aired-border-focus` + ambient purple glow on parent `.form-container:focus-within` |
| Dividers inside a panel | `border-t border-aired-border` |
| Focus ring (`.focus-ring:focus-visible`) | `0 0 0 2px #0a0a0b, 0 0 0 4px rgba(124, 106, 239, 0.4)` — two-stop ring with bg gap |

The two-stop focus ring (bg + purple) is signature. Don't replace it with a flat outline.

---

## 7. Shadows

aired does not use elevation shadows. The only shadow in the system is the **focus glow** on `.form-container`:

```css
.form-container:focus-within {
  box-shadow: 0 0 0 1px #3b3b40, 0 0 40px -12px rgba(124, 106, 239, 0.08);
}
```

**No shadows on:** buttons, cards, install cards, kbd, the result card. Surfaces are differentiated by `bg` + `border` only.

---

## 8. Components

The web app composes only a handful of repeating elements. Each is documented from its actual implementation in `apps/web/index.html` — that file is the source of truth. If you change a component, update both.

### 8.1 Button — primary

Single use: the **Publish** button. One per view.

- `bg-aired-accent text-white`
- `rounded` (8px), `px-4 py-2.5`, `text-sm font-medium`
- Hover: `bg-aired-accent-hover`
- Disabled: `opacity-30 cursor-not-allowed`
- Transition: `all 150ms cubic-bezier(0.16, 1, 0.3, 1)` — defined as `ease-out-expo` in config
- Loading: spinner replaces icon (if any), text stays, `disabled` set on button
- Label: action verb. **"Publish"**, not "Submit", not "Go", not "Create link".

### 8.2 Button — secondary / copy

Used for copy actions and tertiary controls.

- `bg-aired-surface border border-aired-border text-aired-text-secondary`
- `rounded`, `text-xs` or `text-sm` depending on context
- Hover: `bg-aired-surface-hover` + `border-aired-border-focus`
- "Copied" state: `text-[#34d399] border-[rgba(52,211,153,0.3)]` — green, no fill change
- Transition: 120ms ease-out-expo (faster than primary — feels "tappier")

### 8.3 Input / Textarea / Select

- `bg-aired-surface border border-aired-border rounded`
- `text-aired-text-primary` body, placeholder `text-aired-text-tertiary`
- Focus: `border-aired-border-focus`, parent `.form-container` glows purple
- Native browser focus outline removed (`outline: none`) **only because** the focus glow on the parent container is the visible focus indicator. Never remove `outline` on a control without an equivalent.
- Number inputs: hide spinners (`-webkit-inner-spin-button` etc.).
- Selects: hide native arrow (`background-image: none`), provide an inline SVG chevron.
- Placeholders are example values, not instructions: `"a1b2c3d4e5"`, not `"Enter your ID"`.
- Always paired with a `<label>` — the form-label color is `text-aired-text-secondary`.

### 8.4 kbd (keyboard shortcut badge)

Dedicated component for terminal-feel shortcut hints (`⌘V`, `Esc`).

- `font-family: 'Inter'` (not mono — too heavy at this size)
- `font-size: 0.6875rem` (`text-2xs`)
- `padding: 1px 5px`
- `border: 1px solid #222225`, `background: #111113`, `color: #56565a`, `border-radius: 4px`

### 8.5 Install card

The CLI/MCP install hint blocks under the form.

- `bg-aired-surface border border-aired-border rounded-lg p-6`
- Hover: `border-aired-border-focus bg-[rgba(17,17,19,0.5)]` — barely-there
- Inside: title (text-lg), one-line description, monospace command in a nested `surface` block
- Transition: `border-color 150ms ease, background-color 150ms ease`

### 8.6 Result card

Appears after successful publish.

- Same as install card (`bg-aired-surface border rounded-lg p-6`)
- Inline animation on appearance: opacity + transform 200ms ease-out-expo
- Contains: the URL (mono, large, `text-aired-accent`) + copy button + secondary actions (info, delete) as ghost buttons

### 8.7 Empty / error inline messaging

One exception: the dashboard with no pages shows a panel with three steps and an example of two page rows (dashed border, labelled "Example"), because the people who pay are not developers and need to see what the list will hold. Everywhere else:

No decorative empty-state cards — no illustrations, no big "Get started" panels, no celebratory copy. A single inline factual line is allowed (and required) when the user lands somewhere with no data and no obvious path forward. Treat it like a CLI: an empty list prints nothing if the next step is implied, or one line if it isn't.

**Empty state (when shown at all):**
- One sentence, factual, sentence case.
- Names the next action and the tool to do it (CLI command, page link).
- Same color/size as helper text: `text-sm text-aired-text-secondary`.
- Mono for any command literal: `aired publish file.html`.
- Example: `Nothing aired yet. Publish from the homepage or run aired publish file.html.`

**Form-level errors:**
- Single line below the input: `text-xs text-red-400`
- Factual + next step: `"Could not publish. Try again."` not `"Oops! Something went wrong!"`

---

## 9. Page Patterns

The web app is one page (`apps/web/index.html`). The pattern below is what that page is.

### 9.2 Marketing pages (homepage, /pricing)

Wide layout, max-width 1120px, built from standard landing-page blocks in `apps/web/site.css`:

- Header: logo mark + Pricing / Docs / Guides, "Log in", light "Start free" button
- Hero: H1 + the real publish form on the left, an example published page on the right
- "Works with" strip of real tool logos (Simple Icons paths, `currentColor`)
- Animated beam (tools → aired → devices), bento grid of features, split section with a dashboard example, hairline feature grid, live numbers from `/api/stats`, plan cards, FAQ accordion, logo-wall CTA
- Cards: 16px radius, `1px solid rgba(255,255,255,.08)`, inset top glow `0 -20px 80px -20px rgba(255,255,255,.07)`
- Features that don't exist yet are labelled "soon"; plans that aren't open show "Coming soon" instead of a buy button

### 9.3 Inner pages (guides, docs, dashboard, claim, abuse, 404)

Built from the shared kit at the end of `site.css`. Same header, footer, cards and buttons as the homepage.

- **Guides:** hero with breadcrumb, H1, lede and the homepage publish form on the left; on the right "What they open" (an example page, a PIN screen or a comparison) and three ticks. Below: sticky "On this page" contents (hidden under 900px), the article in `.prose`, the first how-to list as numbered step cards (`ol.steps`), the FAQ as the homepage accordion (same text as the FAQPage JSON-LD), and cards for the other guides.
- **Docs:** eyebrow + H1 + four path cards (Skill, CLI, MCP, API), then contents + `.prose` with code blocks and `.snip` copy rows. Developer detail lives here, one click from every page.
- **Dashboard:** a separate React app. See §9.4.
- **Claim, abuse, 404:** `.duo` two columns: the task on the left in a `.panel`, context on the right (where the page goes, what happens next, popular guides).
- Buttons are `.btn` (secondary), `.btn.solid` (the one primary action), `.btn.ghost`, `.btn.sm`. Fields are `.field` inside `.fl` labels.

### 9.4 Dashboard app (`apps/dashboard`, React + shadcn/ui on Base UI)

The signed-in dashboard is the one page not built from `site.css`. It's a Vite + React + TypeScript app using shadcn/ui components on Base UI and Tailwind v4, scoped to `apps/dashboard`, so the marketing site's Tailwind 3 setup and `site.css` are untouched.

- **Build:** `pnpm --filter @aired/dashboard build` writes `apps/web/dashboard.html` and `apps/web/dashboard-assets/`. Both are gitignored. `apps/worker/wrangler.toml` runs that build as its `[build]` command, so every `wrangler dev` and `wrangler deploy` builds a fresh dashboard. The Worker's `/dashboard` route (sign-in check, then the static file) is unchanged.
- **Tokens:** DESIGN.md's palette under shadcn's variable names, in `apps/dashboard/src/index.css`:
  - `--background` #0a0a0b, `--card` #111113, `--muted`/`--accent` #18181b, `--border` #222225, `--input` #34343a;
  - `--foreground` #ededef, `--muted-foreground` #a1a1a6, plus an extra `--subtle` #84848a for the third text tier;
  - `--primary` is the light button (#ededef on #0a0a0b);
  - `--ring` and `--mark` are #7c6aef: focus rings, the logo mark and eyebrows only;
  - `--destructive` is red-400, for destructive actions and errors only;
  - `--radius` is 12px. Dark only (`<html class="dark">`).
- **Fonts:** Inter and JetBrains Mono from `/fonts/fonts.css`, the same self-hosted files as the site. No Geist, no Google.
- **Shell:** shadcn `Sidebar`, which becomes a drawer on phones, opened from a hamburger in the header.
  - Sidebar: logo, **Publish a page**, Pages / Connect your AI tools / Plan & billing / Account, then Guides/Docs/Pricing and an account card showing the plan.
  - The header and footer copy the site's: nav links, `@login`, a light **Publish** button, and the same footer links.
  - Views live on `#pages`, `#connect`, `#billing` and `#account`. `?upgraded=1` and `?billing=…` open `#billing`.
- **Components used:**
  - Sidebar;
  - Data Table (TanStack Table v8), with project group rows, sortable Page/Expires/Views columns, and cards under 768px;
  - Card for the summary tiles;
  - Input Group for search;
  - Toggle Group for filters (chips with counts);
  - Badge for status (Live / Expiring / Expired / PIN);
  - Dropdown Menu for the row "…" menu;
  - Alert Dialog for deleting a page, revoking a key and deleting the account;
  - Dialog for a new key, with the key shown once;
  - Tabs for the four tool setups;
  - Collapsible for Developer keys;
  - Empty for the first-page state;
  - Sonner for toasts ("Copied", "Deleted …", "You're on Pro").
- **Copy:** plain words. The jargon (MCP, header, `AIRED_API_KEY`) appears only inside Developer keys. Connector setup steps don't name menu paths, because those change between app versions.
- **Accessibility:** one `<main>` (our `SidebarInset` renders a div), and focus moves to the view's H1 on navigation. Dialogs trap focus and start on Cancel. Every icon button has an `aria-label`, and touch targets are at least 24px. Lighthouse accessibility is 100 on Pages, Connect, Account and the empty state (desktop), and on Pages and Plan & billing (mobile).
- **Generated files:** `src/components/ui/*` is shadcn's generated source and can be edited (see `sidebar.tsx`). `src/styles/shadcn-base.css` is vendored from `shadcn@4.23.0`, so the CLI isn't a runtime dependency.
- **Dependencies:** every direct dependency is an exact version published at least two weeks before it was added. Base UI's `@babel/runtime` is overridden to 8.1.0 for the same reason.

### 9.5 Dashboard components (one library)

Everything in the dashboard is built from shadcn/ui on Base UI, restyled through tokens and variants, never hand-rolled widgets:

- **aired variants on shadcn primitives:**
  - `Button`: `size="xl"`, `shape="pill"`;
  - `Badge`: `chip`, `warn`, `overlay`;
  - `Card`: `variant="panel" | "hero" | "bare"`;
  - `Toggle`/`ToggleGroup`: `pill` (filter chips), `segment` (segmented controls).
- **Reusable components (`apps/dashboard/src/components/`), each on those primitives:**
  - pages: `PagePreview` (live sandboxed render), `QrPlaceholder`, `PageChips`, `PageTile`, `PageSummaryCard`, `PageListItem`;
  - publishing: `DropZone` (+ `AiToolLinks`);
  - chrome: `AccountMenu` (DropdownMenu), `TopBar`, `BrowserFrame`;
  - controls: `IconAction`/`CopyLinkAction` (Button + Tooltip + Sonner), `Segmented`, `MeterRow`.
- **tailwind-merge** is told that `text-body`, `text-md`, `text-heading`, `text-subheading`, `text-title` and `text-display` are font sizes (`lib/utils.ts`), so they never knock out a text colour.

### 9.1 Single-page tool layout (retired)

No page uses this any more; kept for history.

Vertical stack, max-width 640px, centered. Sections separated by 40-48px.

```
┌──────────────────────────┐
│  hero (logo + tagline)   │  20vh-ish, generous breathing
├──────────────────────────┤
│  form-container          │  the thing they came for
│   ├ paste-area           │
│   ├ controls (TTL, pin)  │
│   └ Publish button       │
├──────────────────────────┤
│  result-card (when set)  │  appears after publish
├──────────────────────────┤
│  install cards (CLI/MCP) │  secondary entry points
└──────────────────────────┘
```

Tool pages have minimal nav and footer chrome. The page is the tool.

### When to add a second page

Don't, unless the new feature can't live in a modal-less inline state. If it needs a route, it probably needs a CLI command instead.

---

## 10. Voice

| Context | Rule | Example |
|---------|------|---------|
| Page title | Lowercase, em-dash, declarative | `"aired — publish HTML artifacts instantly"` |
| Primary button | One verb, no object when obvious | `"Publish"` |
| Form labels | Sentence case, no colons | `"Expires"`, `"Pin"` |
| Placeholder | Example value | `"1h"`, `"1234"` |
| Helper text | Factual fragment, no period | `"Optional. 4-8 digits."` |
| Result | Just the URL — no celebration | `aired.sh/p/a1b2c3d4e5` |
| Error | What happened + what to do | `"Could not publish. Try again."` |
| Loading | Present participle | `"Publishing…"` |
| Toast | Past tense, one line | `"Copied"` |

**Never:**
- Emojis in UI (✨🚀🎉) — none, anywhere, ever
- Exclamation marks
- "Supercharge", "unlock", "leverage", "seamless", "powerful", "blazing fast"
- "Oops!", "Hang tight!", "Whoops!"
- "Awesome!", "Great!", "Got it!" as confirmations — use the past-tense fact instead
- Capitalized "Sentence Case" for ordinary UI text — labels are sentence case, brand is `aired` (lowercase)
- The word "users" in any UI copy — there is one person doing one thing

---

## 11. Do / Don't

| Situation | Do | Don't |
|-----------|----|-------|
| Page background | `bg-aired-bg` (#0a0a0b) | Pure black or pure white |
| Card surface | `bg-aired-surface` (#111113) | `#000` or any flat black |
| Borders | 1px (`border-aired-border`) | 0.5px, 2px, or dashed |
| Heading weight | `font-medium` (500) | `font-bold`, `font-semibold` |
| Body text size | 14px (`text-base` in this scale) | 16px |
| Brand purple | Primary button + result link | Hover backgrounds, borders, body text |
| Status green | Copy "copied" state, success toasts | Buttons, badges, decorative use |
| Radius | `rounded` (8px) controls, `rounded-lg` (12px) cards | `rounded-xl`, `rounded-2xl`, `rounded-full` (no pills) |
| Shadows | Only the form-container focus glow | Drop shadows on cards, buttons |
| Focus | Two-stop ring (bg gap + purple) | Default browser outline, single flat ring |
| Transitions | 120-200ms `ease-out-expo` | 300ms+, `ease-in-out` |
| Empty data | One inline factual line naming the next action; nothing if next action is obvious | "No items yet" decorative cards, illustrations, big "Get started" panels |
| Confirmations | Past-tense fact (`"Copied"`) | `"Got it!"`, `"Awesome!"` |
| New feature | Prefer CLI flag over new web UI | Add a route, modal, or settings page |

---

## 12. Pattern Log

Append-only record of design decisions. One line per entry. Append on every notable change so future-you (or `/forge:design memorize`) has a trail.

```
2026-05-09 — DESIGN.md bootstrapped from existing tokens in apps/web/tailwind.config.js. Dark-only, purple-accent (#7c6aef), 14px body, ease-out-expo motion.
2026-05-10 — Empty-state rule softened: one inline factual line allowed (required) when user has no breadcrumb to the next action; decorative cards still forbidden. Dashboard 0-pages state is the canonical example.
2026-11-25 — Live numbers: count up on view, static charts on the totals, the top three countries from /api/stats with SVG flags from flag-icons (images, not emoji, so they render on Windows).
2026-11-25 — Homepage and /pricing rebuilt as marketing pages (site.css): wide layout, bento and feature grids, plan cards, logo-wall CTA. Primary button is now light; purple limited to the mark, focus and eyebrows. Text tokens raised for contrast (secondary #a1a1a6, tertiary #84848a). Globe and live title ticker removed.
2026-11-26 — One token source: packages/ui-tokens/tokens.css feeds site.css (via /tokens.css) and the dashboard theme; a dark default and a proposed warm light set ([data-theme="warm"]). Dashboard directions A/B/C rebuilt only from shadcn primitives + aired variants + shared components (§9.5). Test guards the copy and the mappings.
2026-11-25 — Dashboard moved to React + shadcn/ui (Base UI) + Tailwind v4 in apps/dashboard, built by wrangler into apps/web. Same sections and flows as the vanilla app shell below; page list is now a shadcn Data Table, confirmations are Alert Dialogs, new keys use a Dialog. See §9.4.
2026-11-25 — Dashboard rebuilt as an app: sidebar shell (tabs on mobile), hash views for Pages / Connect your AI tools / Plan & billing / Account, summary tiles, search and filter chips over all pages loaded at once (cap 1,000), "…" row menu, tool setup cards with developer keys collapsed, account card with typed-DELETE account deletion. Exceptions: the row menu has a drop shadow (popovers need separation), and destructive actions (Delete page, Delete my account) use red-400.
2026-11-25 — Remaining narrow pages moved to the wide layout: 7 guides, docs, dashboard, claim, abuse, 404. Shared kit in site.css (.btn, .panel, .field, .prose, .toc, ol.steps, .gcard, .strip, .chip, .duo). Dashboard v2: plain-language chips per page, project cards, empty state with an example (exception to §8.7). Tailwind build no longer loaded. Homepage `.v` timeline rules scoped to `.vers` so they stop hitting `.row .v`.
2026-11-21 — Guide pages added (/html-to-link, /share-claude-artifacts, /tiiny-host-alternative). They reuse the homepage form and tokens, keep 14px body and 18px h2, and exist for search traffic from non-technical visitors. Homepage H1 and button now use font-medium and "Publish" per §3 and §8.1.
```
