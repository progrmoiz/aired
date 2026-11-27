---
name: aired-slides
description: Makes slide decks with aired and shares them as a link you can present from. Markdown or HTML slides, speaker notes only the owner sees, a speaker view, slide links and PDF export. Use when the user wants a presentation, pitch deck, talk, training or meeting slides, or wants to turn notes or a doc into slides they can present or send. Builds on the aired skill (publishing, sign-in, limits).
---

# Slide decks with aired

A deck is one Markdown or HTML file. aired adds the slide viewer: arrow keys, Space, Page Up/Down, swipe on phones, **F** or the Present button for full screen, and **S** for the speaker view.

## Start from the template

```bash
aired new deck            # writes deck.md (Markdown)
aired new deck-html       # writes deck.html (custom layouts, charts)
```

Over MCP: `get_template` with `{ "name": "deck" }` returns the same starter and the rules for filling it in.

## Worked example (Markdown)

```markdown
---
type: deck
title: Q3 update
theme: light
---

# Q3 update

Acme Co · October 2026

Note: Welcome. Ten minutes: what shipped, the numbers, what's next.

---

## What shipped

- Checkout in two steps instead of five
- A dashboard for account managers
- 14 fixes from customer feedback

Note: Start with checkout. It's the change customers noticed most.

---

## The numbers

| Metric | Q2 | Q3 |
| --- | ---: | ---: |
| Revenue | $182k | $214k |
| Customers | 1,240 | 1,395 |
```

Rules:

- Front matter `type: deck` makes it a deck; `theme` is `light` or `dark`.
- Slides split on lines that are only `---`. A slide that starts with `# ` is a title slide; the rest start with `## `.
- One idea per slide, at most five short bullets or a small table. No paragraphs.
- Speaker notes: a line starting with `Note:` (everything after it on that slide), or an `<!-- comment -->`.
- Use only real figures. Where one is missing, write `[number]` rather than guessing.

## Publish

```bash
aired deck.md --title "Q3 update"
```

Over MCP, call `publish_html` with:

```json
{ "markdown": "---\ntype: deck\ntitle: Q3 update\n---\n\n# Q3 update\n...", "deck": true, "title": "Q3 update" }
```

The result has `kind: "deck"`, `slides`, and a `presenter_url` (the speaker view). Publish signed in (`aired login` or `AIRED_API_KEY`) so the owner can open the speaker view.

## HTML decks

- Keep `<meta name="aired" content="deck">` (or pass `--deck` / `deck: true`).
- Each top-level `<section>` is one slide, designed at 1280×720. aired scales it to any screen and adds the controls: don't add your own.
- Notes go in `<aside class="notes">` inside a slide.
- Inline the CSS. Chart libraries and fonts from a CDN are fine.

## Present and share

| Link | What it opens |
|---|---|
| `https://aired.sh/p/<id>` | The deck, for anyone with the link |
| `https://aired.sh/p/<id>#/3` | Slide 3 (the viewer's link button copies the current slide) |
| `https://aired.sh/p/<id>/presenter` | The speaker view: notes, next slide, a timer, and buttons that move the slides window. Owner only, signed in |

- Notes are cut out of the public page when you publish. Only the signed-in owner sees them. An anonymous deck's notes come back only through `get_page` with `include_source` and its update token.
- Print (Save as PDF) gives one slide per page, so the deck exports as a PDF.
- Need it private? Add a PIN or share with named people: see `aired-report`.

## Check before sharing

```bash
aired check <id>
aired check <id> --mobile
```

Over MCP: `check_page` with `{ "id": "<id>" }`, then again with `"viewport": "mobile"`. Fix what it reports, update the same id, check once more. Then give the user the deck link, a slide link like `#/2`, and the speaker view link.

## Change a slide later

```bash
aired update <id> deck.md -m "Fix Q3 revenue"
```

The link stays the same. Over MCP: `publish_html` with `id` and `update_token` (or `id` alone when signed in as the owner), or `update_page` on the remote server. Every update keeps the old version: `aired versions <id>`, `aired restore <id> <n>`.

## Gotchas

- Raw HTML inside a Markdown deck shows as text. Need custom HTML? Use `deck-html`.
- Images: the CLI puts local images (`![](./chart.png)`, up to 1 MB each) into the page. Over MCP, use `https://` or `data:` image URLs.
- The deck is one file, at most 2 MB on Free (10 MB on Pro). Big photos push past it: shrink them first.
- Pages run in a sandbox: the deck can't be put in an iframe on another site, and `localStorage` is lost on reload.
- Updating a deck that expires sets its expiry to 7 days from then.
- Checks share a small daily browser budget: one per change.
