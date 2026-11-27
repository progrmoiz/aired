# Share your slides as a link

Write a deck in Markdown, or let Claude or ChatGPT make one in HTML. Publish it here and send one link: people click through it on any device, you present it full screen, and your speaker notes stay private.

Source: https://aired.sh/share-slides

## Write it in Markdown

The quickest deck is a Markdown file. Put `type: deck` at the top and three dashes between slides:

```
---
type: deck
title: Q3 update
---

# Q3 update
Acme Co · October 2026

Note: Welcome everyone. Ten minutes, then questions.

---

## What we shipped
- Faster checkout: two steps instead of five
- New dashboard for account managers
```

A slide that starts with one `#` is a title slide; the rest start with `##`. Tables, code and images work. Drop the file in the box above, or from a terminal:

1. **Start from a template:** `npx aired new deck` writes `deck.md` with seven example slides.
2. **Edit it,** then publish: `npx aired deck.md`.
3. **Open the link,** check it on your phone, and send it.

Change a slide later with `npx aired update <id> deck.md`. The link stays the same, so nobody needs a new one.

## Or use HTML slides

For your own layouts, charts or brand colours, write HTML where each top-level `<section>` is a slide designed at 1280 × 720, and add `<meta name="aired" content="deck">` to the head. aired scales each slide to fit the screen and adds the controls. `npx aired new deck-html` gives you a starting point. Decks made for reveal.js keep their notes the same way.

## Present it

- **Move:** arrow keys, Space, Page Up and Page Down (so presentation clickers work), Home and End. On a phone, swipe.
- **Present:** press F or the Present button. The controls fade until you move the mouse.
- **Link to a slide:** the link button copies the address of the slide you're on, like `aired.sh/p/abc#/3`.
- **PDF:** print the page and choose Save as PDF; each slide gets its own page.

## Speaker notes

In Markdown, start a line with `Note:` and everything after it on that slide is a note. In HTML, put notes in `<aside class="notes">`. When you publish, aired takes the notes out of the page, so nobody watching can find them, not even in the page source.

Publish while signed in, then press S on the slides (or open `/p/<id>/presenter`) for the speaker view: the notes for the current slide, what's next, a timer, and buttons that move the slides in the other window. Put the slides on the big screen and keep the speaker view on your laptop.

## Let your AI make the deck

Claude, ChatGPT and coding agents write good Markdown decks. Ask for "a Markdown slide deck with --- between slides and Note: lines for what I'll say", then drop it above. With aired's [MCP server](https://aired.sh/docs#mcp) connected, the `make_slide_deck` prompt does the whole thing: it fetches the deck template, writes the slides and notes, publishes them and checks the result in a browser. The agent can fix a slide later at the same link.

## Questions

### Do people need an account to watch the slides?

No. The link opens in any browser, on a laptop, a phone or the meeting-room screen. Nobody signs up.

### Can I link to one slide?

Yes. Add #/3 to the link to open slide 3. The link button on the slides copies the link to the slide you're on.

### Can viewers see my speaker notes?

No. aired cuts the notes out of the page when you publish. Only you see them, signed in, in the speaker view.

### Can I turn the deck into a PDF?

Yes. Print the page and choose Save as PDF: each slide goes on its own page.

### Can Claude or ChatGPT write the deck?

Yes. Ask for a Markdown deck with --- between slides and Note: lines for what you'll say, or use the make_slide_deck prompt in aired's MCP server, which starts from aired's deck template.

### Is it free?

Yes. Publishing, presenting and viewing are free. Speaker notes need a free account, so aired knows the deck is yours.

Updated November 2026.
