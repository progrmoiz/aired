import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSpam } from "../src/lib/spam.ts";
import { applyPageHeaders } from "../src/middleware/security.ts";

const page = (title: string, body: string) =>
  `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

// Shapes taken from spam actually published to aired.sh (domains changed).
const spam: Array<[string, string, string]> = [
  [
    "casino domain link",
    "A Practical Checklist for Comparing Online Games",
    `<p>Choosing an online game is easier with a consistent checklist.</p><a href="https://syndicate-casino-example.info/games/">source</a>`,
  ],
  [
    "bonus path on a neutral domain",
    "Bonusbedingungen vor der Registrierung prüfen",
    `<p>Ein Bonus kann interessant wirken, doch entscheidend sind die Bedingungen.</p><a href="https://spinsy-example.eu/bonus/">Quelle</a>`,
  ],
  [
    "weak host plus promo copy",
    "Comparing Online Slot-Style Games: A Reader Checklist",
    `<p>Check payout rates and withdrawal limits.</p><a href="https://pokie-machines-example.com/">guide</a>`,
  ],
  [
    "betting brand domain",
    "A note about Monopoly",
    `<p>Prepared by an independent web researcher.</p><a href="https://monopolybetuk.com">site</a>`,
  ],
  [
    "promo text with no link",
    "Stay Casino Australia bonus terms",
    `<p>Grab your welcome bonus, check wagering rules and enjoy fast payouts.</p>`,
  ],
  [
    "protocol-relative link",
    "Guide",
    `<a href="//online-casino-example.com/x">x</a>`,
  ],
];

for (const [name, title, body] of spam) {
  test(`blocks spam: ${name}`, () => {
    const verdict = detectSpam(page(title, body), title);
    assert.equal(verdict.spam, true);
  });
}

// Legit pages people publish: games, booking tools, links to normal sites.
const legit: Array<[string, string, string]> = [
  [
    "blackjack game",
    "Blackjack",
    `<p>Place your bet and beat the dealer. Blackjack pays 3:2.</p><script>let bet = 10; const payout = bet * 1.5;</script>`,
  ],
  [
    "slot machine game",
    "Neon Slot Machine",
    `<p>Spin the reels! Three cherries hit the jackpot.</p><a href="https://github.com/someone/neon-slots">source</a>`,
  ],
  [
    "booking page that mentions slots",
    "Book a time slot",
    `<p>Pick a slot below. A deposit is required to confirm.</p><a href="https://calendly.com/someone">book</a>`,
  ],
  [
    "poker night invite linking to a map",
    "Friday poker night",
    `<p>Bring snacks. Buy-in is $20.</p><a href="https://maps.google.com/?q=park">directions</a>`,
  ],
  [
    "restaurant site",
    "Cook's Lobster & Ale House",
    `<p>Fresh lobster daily.</p><a href="https://www.instagram.com/cookslobster">Instagram</a>`,
  ],
  [
    "link back to aired",
    "Report",
    `<a href="https://aired.sh/p/abc123">previous casino report</a>`,
  ],
];

for (const [name, title, body] of legit) {
  test(`allows legit page: ${name}`, () => {
    const verdict = detectSpam(page(title, body), title);
    assert.equal(verdict.spam, false, JSON.stringify(verdict));
  });
}

test("anonymous pages are served with noindex", () => {
  const headers = new Headers();
  applyPageHeaders(headers, { indexable: false });
  assert.equal(headers.get("X-Robots-Tag"), "noindex, nofollow");
});

test("signed-in owners' pages stay indexable", () => {
  const headers = new Headers();
  applyPageHeaders(headers, { indexable: true });
  assert.equal(headers.get("X-Robots-Tag"), null);
});
