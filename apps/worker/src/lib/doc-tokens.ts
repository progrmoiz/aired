/**
 * The aired design tokens a Markdown page uses (lib/doc-render.ts), copied
 * from packages/ui-tokens/tokens.css: published pages are served in their own
 * sandboxed origin and can't load aired's stylesheet, so the values travel
 * inside each page. `light` is the Daylight theme, `dark` is Midnight.
 * test/doc-tokens.test.ts fails if any value here drifts from tokens.css.
 * No imports, so tests load it directly.
 */

const SHARED = {
  "--aired-font-sans": "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  "--aired-font-mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "--aired-text-md": "16px",
  "--aired-text-lg": "18px",
  "--aired-text-xl": "22px",
  "--aired-text-2xl": "26px",
  "--aired-text-3xl": "34px",
  "--aired-weight-medium": "500",
  "--aired-tracking-tight": "-0.025em",
  "--aired-radius-md": "8px",
} as const;

export const DOC_TOKENS = {
  light: {
    ...SHARED,
    "--aired-radius-lg": "12px",
    "--aired-bg": "#f7f7f8",
    "--aired-surface": "#ffffff",
    "--aired-surface-2": "#f1f1f3",
    "--aired-code-bg": "#f1f1f3",
    "--aired-border": "#e4e4e7",
    "--aired-border-strong": "#d4d4d8",
    "--aired-hairline": "rgba(10, 10, 20, 0.08)",
    "--aired-hairline-strong": "rgba(10, 10, 20, 0.18)",
    "--aired-text-1": "#111113",
    "--aired-text-2": "#52525b",
    "--aired-text-3": "#6b6b73",
    "--aired-warn-bg": "#fdecd5",
  },
  dark: {
    ...SHARED,
    "--aired-radius-lg": "12px",
    "--aired-bg": "#0a0a0b",
    "--aired-surface": "#111113",
    "--aired-surface-2": "#18181b",
    "--aired-code-bg": "#070708",
    "--aired-border": "#222225",
    "--aired-border-strong": "#34343a",
    "--aired-hairline": "rgba(255, 255, 255, 0.08)",
    "--aired-hairline-strong": "rgba(255, 255, 255, 0.18)",
    "--aired-text-1": "#ededef",
    "--aired-text-2": "#a1a1a6",
    "--aired-text-3": "#84848a",
    "--aired-warn-bg": "rgba(251, 191, 36, 0.12)",
  },
} as const;

/** `--name:value` pairs joined for a CSS rule. */
export function tokenVars(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
