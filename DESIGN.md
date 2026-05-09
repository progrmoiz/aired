# aired Design System

*Version 1.0 — 2026-05-09*

The single reference for building any UI in aired. Read before writing any component, page, or layout. Updated when patterns evolve.

**Stack:** pnpm monorepo. Web app is vanilla HTML + JS + Tailwind 3 (`apps/web/`). No React, no shadcn — utility classes against the tokens in `tailwind.config.js`.
**Icons:** Inline SVG, hand-picked. No library.
**Fonts:** Inter (400, 500, 600), JetBrains Mono (400, 500). Both via Google Fonts `<link>`.
**Voice:** see §10 below
**Audience:** Developer mid-task. Pasted HTML from Claude, ran a script, generated an artifact — they want a shareable URL right now, then leaving in 30 seconds. Indie hackers shipping prototypes are a superset of the same need.
**Brand keywords:** Instant. Terminal. Quiet.

---

## 1. Principles

Numbered, ordered by priority. When unsure, run the decision through these.

1. **Speed is the feature.** Anything that delays the URL — modal, signup, toast, animation — is wrong. The page exists to turn HTML into a link in seconds.
2. **Dense, not loud.** Body text is 14px. Max heading is 24px. No giant marketing typography. The page should read like a CLI man page, not a SaaS landing.
3. **Quiet by default.** Neutrals carry the layout. Brand purple appears only on the primary action and the result. One purple thing per view.
4. **States are not optional.** Every interactive element: default, hover, active, focus, disabled. Every async action: idle, pending, success, error.
5. **Strong defaults, no configuration.** TTL has a default. Visibility has a default. Pin is empty. The form should produce a URL with one click.

---

## 2. Color Tokens

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
  'text-secondary': '#8a8a8e',  // labels, captions
  'text-tertiary':  '#56565a',  // placeholders, disabled, kbd
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
| Primary CTA ("Publish") | `bg-aired-accent` text white, hover `bg-aired-accent-hover` |
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

Loaded in `apps/web/index.html` via Google Fonts. Do not import via JS or `next/font` — this is a static HTML site.

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

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

There is no "EmptyState" component — aired's UI never has empty data views. For form-level errors:

- Single line below the input: `text-xs text-red-400`
- Factual + next step: `"Could not publish. Try again."` not `"Oops! Something went wrong!"`

---

## 9. Page Patterns

The web app is one page (`apps/web/index.html`). The pattern below is what that page is.

### 9.1 Single-page tool layout

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

There is no nav, no sidebar, no footer chrome. The page is the tool.

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
| Empty data | Don't show the empty state — show nothing | "No items yet" decorative cards |
| Confirmations | Past-tense fact (`"Copied"`) | `"Got it!"`, `"Awesome!"` |
| New feature | Prefer CLI flag over new web UI | Add a route, modal, or settings page |

---

## 12. Pattern Log

Append-only record of design decisions. One line per entry. Append on every notable change so future-you (or `/forge:design memorize`) has a trail.

```
2026-05-09 — DESIGN.md bootstrapped from existing tokens in apps/web/tailwind.config.js. Dark-only, purple-accent (#7c6aef), 14px body, ease-out-expo motion.
```
