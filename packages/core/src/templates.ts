/**
 * Starting points for common pages, the same everywhere: `aired new <name>`
 * in the CLI, the get_template tool on both MCP servers, and the
 * make_slide_deck and publish_report prompts. Each one publishes as it is,
 * so an agent can fill it in and publish without guessing at the format.
 */

export type Template = {
  name: string;
  title: string;
  /** One line: what it's for. */
  description: string;
  format: "markdown" | "html";
  /** Show as slides (publish with deck: true; the Markdown ones say so in front matter too). */
  deck: boolean;
  /** The file `aired new` writes. */
  filename: string;
  /** How to fill it in, for agents. */
  rules: string[];
  content: string;
};

const DECK_MD = `---
type: deck
title: Quarterly update
theme: light
---

# Quarterly update

Acme Co · Q3 2026

Note: Welcome everyone. This covers what shipped, the numbers, and what's next. About ten minutes.

---

## Agenda

1. What we shipped
2. The numbers
3. What's next

---

## What we shipped

- **Faster checkout:** two steps instead of five
- **New dashboard** for account managers
- 14 smaller fixes from customer feedback

Note: Start with checkout. It's the change customers noticed most.

---

## The numbers

| Metric | Q2 | Q3 | Change |
| --- | ---: | ---: | ---: |
| Revenue | $182k | $214k | +18% |
| Active customers | 1,240 | 1,395 | +12% |
| Churn | 3.1% | 2.4% | −0.7 pts |

Note: Churn is the one to dwell on. It's the lowest it has been in two years.

---

## What's next

- [x] Agree the Q4 plan
- [ ] Launch the mobile app in November
- [ ] Hire two people for support

---

## What customers said

> "The new checkout cut our support tickets in half."
>
> — Operations lead, a retail customer

---

# Thank you

Questions? hello@example.com
`;

const DECK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="aired" content="deck">
<title>Product launch</title>
<style>
  /* Each top-level <section> is one slide, designed at 1280 × 720. aired scales it to fit. */
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; color: #111113; background: #ffffff; }
  section { padding: 80px 96px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
  h1 { font-size: 84px; font-weight: 500; letter-spacing: -0.03em; line-height: 1.05; margin: 0; }
  h2 { font-size: 54px; font-weight: 500; letter-spacing: -0.02em; margin: 0 0 8px; }
  p, li { font-size: 30px; line-height: 1.45; color: #3f3f46; margin: 0; }
  ul { margin: 0; padding-left: 1.1em; display: grid; gap: 10px; }
  .muted { color: #6b6b73; }
  .dark { background: #0a0a0b; color: #ededef; }
  .dark p { color: #a1a1a6; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .stat { border: 1px solid #e4e4e7; border-radius: 16px; padding: 28px; }
  .stat b { display: block; font-size: 64px; font-weight: 500; letter-spacing: -0.02em; }
  .stat span { font-size: 22px; color: #6b6b73; }
</style>
</head>
<body>

<section class="dark">
  <p class="muted">Launch review · 2026</p>
  <h1>Meet Relay</h1>
  <p>Send a page, get feedback in one place.</p>
  <aside class="notes">Speaker notes go in aside class="notes". Only you see them, in the speaker view. Press S while presenting.</aside>
</section>

<section>
  <h2>The problem</h2>
  <ul>
    <li>Feedback lives in five apps</li>
    <li>Nobody knows which version is current</li>
    <li>Clients give up and call</li>
  </ul>
  <aside class="notes">Tell the story of the client who replied to the wrong email thread.</aside>
</section>

<section>
  <h2>Early results</h2>
  <div class="stats">
    <div class="stat"><b>3×</b><span>faster sign-off</span></div>
    <div class="stat"><b>41%</b><span>fewer emails</span></div>
    <div class="stat"><b>9/10</b><span>would recommend</span></div>
  </div>
</section>

<section class="dark">
  <h2>Thank you</h2>
  <p>hello@example.com</p>
</section>

</body>
</html>
`;

const REPORT_MD = `---
title: Monthly report · November 2026
---

# Monthly report: November 2026

Prepared for Acme Co by Northwind Studio · 1 December 2026

## Summary

Website visits grew **18%** on October, mostly from search. Sign-ups followed, up 11%. Ad spend stayed flat, so each new customer cost less. Next month we focus on the pricing page, where most visitors leave.

## Key numbers

| | October | November | Change |
| --- | ---: | ---: | ---: |
| Visits | 24,180 | 28,530 | +18% |
| Sign-ups | 612 | 680 | +11% |
| Cost per sign-up | $14.20 | $12.75 | −10% |
| Pricing page exits | 62% | 64% | +2 pts |

## What we did

### Search

- Rewrote the five pages that get the most search visits
- Fixed 38 broken links found in the site audit

### Ads

- Paused the two campaigns with the highest cost per sign-up
- Tested a shorter headline: 9% more clicks

## What's next

- [x] Agree December priorities with your team
- [ ] Test a simpler pricing page (two plans instead of four)
- [ ] Add customer quotes to the sign-up page
- [ ] Send the next report on 2 January

## Questions

Reply to this report or email hello@northwind.example.
`;

const ONE_PAGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relay · one-pager</title>
<style>
  :root { --bg: #ffffff; --text: #111113; --muted: #52525b; --line: #e4e4e7; --soft: #f4f4f5; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0b; --text: #ededef; --muted: #a1a1a6; --line: #222225; --soft: #111113; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 72px 24px 96px; }
  .eyebrow { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  h1 { font-size: clamp(34px, 6vw, 48px); font-weight: 500; letter-spacing: -0.03em; line-height: 1.1; margin: 12px 0 16px; }
  .lede { font-size: 19px; color: var(--muted); margin: 0 0 40px; }
  h2 { font-size: 22px; font-weight: 500; margin: 48px 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .card { border: 1px solid var(--line); border-radius: 12px; padding: 18px; background: var(--soft); }
  .card b { display: block; font-weight: 500; margin-bottom: 4px; }
  .card p { margin: 0; color: var(--muted); font-size: 15px; }
  .numbers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center; }
  .numbers b { display: block; font-size: 34px; font-weight: 500; letter-spacing: -0.02em; }
  .numbers span { color: var(--muted); font-size: 14px; }
  .cta { margin-top: 48px; padding: 24px; border: 1px solid var(--line); border-radius: 12px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
  .cta a { background: var(--text); color: var(--bg); text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 500; }
  @media (max-width: 560px) { .numbers { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <div class="eyebrow">Product one-pager</div>
  <h1>Relay: feedback on any page, in one place</h1>
  <p class="lede">Send a link. Your client comments right on the page. You see every note, in order, with the version it was about.</p>

  <div class="numbers">
    <div><b>3×</b><span>faster sign-off</span></div>
    <div><b>41%</b><span>fewer emails</span></div>
    <div><b>2 min</b><span>to set up</span></div>
  </div>

  <h2>What it does</h2>
  <div class="grid">
    <div class="card"><b>Comments on the page</b><p>Click anywhere, leave a note. No account needed.</p></div>
    <div class="card"><b>Every version kept</b><p>Notes stay with the version they were about.</p></div>
    <div class="card"><b>One inbox</b><p>All feedback from every client, sorted.</p></div>
  </div>

  <h2>Who it's for</h2>
  <p>Agencies and freelancers who send work to clients and wait for answers.</p>

  <h2>Pricing</h2>
  <p>Free for three projects. $12 a month for unlimited projects.</p>

  <div class="cta">
    <span>Want a walkthrough?</span>
    <a href="mailto:hello@example.com">Book 15 minutes</a>
  </div>
</main>
</body>
</html>
`;

const COMMON = [
  "Replace every example name, number, date and email with real content. Never invent figures: leave a clear placeholder like [number] if you don't have one.",
  "Leave out secrets, tokens, keys and personal data that shouldn't leave the conversation.",
];

export const TEMPLATES: Template[] = [
  {
    name: "deck",
    title: "Slide deck (Markdown)",
    description: "A slide deck written in Markdown: one slide per --- section, with speaker notes.",
    format: "markdown",
    deck: true,
    filename: "deck.md",
    rules: [
      "Keep the front matter (type: deck). Set title; theme is light or dark.",
      "Slides are split on lines that are only ---. A slide that starts with a single # heading is a title slide (centred, large). Other slides start with ## and a short title.",
      "One idea per slide, at most 5 short bullets or a small table. Big type: no paragraphs.",
      "Speaker notes: a line starting with Note: at the end of a slide; everything after it is notes. Notes never show on the public page, only in the owner's speaker view.",
      "Publish with publish_html using markdown (not html). Link to one slide with #/N on the URL, e.g. /p/abc#/3.",
      ...COMMON,
    ],
    content: DECK_MD,
  },
  {
    name: "deck-html",
    title: "Slide deck (HTML)",
    description: "A slide deck in HTML for custom layouts: each top-level <section> is a 1280×720 slide.",
    format: "html",
    deck: true,
    filename: "deck.html",
    rules: [
      'Keep <meta name="aired" content="deck">: it tells aired to show the page as slides.',
      "Each top-level <section> is one slide, designed at 1280 × 720 pixels; aired scales it to fit any screen and adds the controls, so don't add your own.",
      'Speaker notes go in <aside class="notes"> inside a slide. aired removes them from the public page and shows them only to the owner.',
      "Self-contained: inline CSS, no build step. Scripts or fonts from a CDN only when needed.",
      "Publish with publish_html (html). Link to one slide with #/N on the URL.",
      ...COMMON,
    ],
    content: DECK_HTML,
  },
  {
    name: "report",
    title: "Client report (Markdown)",
    description: "A monthly or project report: summary, a table of key numbers, what was done and what's next.",
    format: "markdown",
    deck: false,
    filename: "report.md",
    rules: [
      "Start with a # title and one line saying who it's for, who made it and the date.",
      "The summary comes first: three or four plain sentences a busy client can read in 20 seconds.",
      "Numbers go in a table, right-aligned (---:), with the change column worded the same way throughout.",
      "Next steps as a task list (- [ ] and - [x]).",
      "Raw HTML in Markdown shows as text; use Markdown only. Code blocks are highlighted.",
      "Publish with publish_html using markdown. It renders as a clean page that works in light and dark mode and on phones.",
      ...COMMON,
    ],
    content: REPORT_MD,
  },
  {
    name: "one-pager",
    title: "One-pager (HTML)",
    description: "A single-page product or project summary: headline, three numbers, what it does, a call to action.",
    format: "html",
    deck: false,
    filename: "one-pager.html",
    rules: [
      "One screen of reading: a headline, one-sentence lede, three numbers, three cards, and one call to action.",
      "Self-contained HTML with inline CSS. It follows the reader's light or dark setting; keep both looking right.",
      "Readable on a phone: no fixed widths.",
      "Publish with publish_html (html).",
      ...COMMON,
    ],
    content: ONE_PAGER_HTML,
  },
];

export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name) as [string, ...string[]];

export function getTemplate(name: string): Template | null {
  const n = name.trim().toLowerCase();
  return TEMPLATES.find((t) => t.name === n || t.name.replace("-", "") === n.replace(/[-_ ]/g, "")) ?? null;
}
