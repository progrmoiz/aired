import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPin, isPinHash, PIN_ITERATIONS, pinCookieValue, verifyPin, verifyPinCookie } from "../src/lib/pin-hash.ts";

test("a stored PIN is a salted PBKDF2 hash that records its format", async () => {
  const a = await hashPin("4242");
  const b = await hashPin("4242");
  assert.match(a, new RegExp(`^pbkdf2-sha256\\$${PIN_ITERATIONS}\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{43}$`));
  assert.notEqual(a, b, "a fresh salt each time");
  assert.ok(!a.includes("4242"));
  assert.equal(isPinHash(a), true);
  assert.equal(isPinHash("4242"), false);
});

test("verifyPin accepts the right PIN and refuses others", async () => {
  const stored = await hashPin("123456");
  assert.deepEqual(await verifyPin("123456", stored), { ok: true, needsRehash: false });
  assert.deepEqual(await verifyPin("123457", stored), { ok: false, needsRehash: false });
  assert.deepEqual(await verifyPin("", stored), { ok: false, needsRehash: false });
  assert.deepEqual(await verifyPin("1234567", stored), { ok: false, needsRehash: false });
});

test("a PIN stored as typed (older pages) still works and asks to be rehashed", async () => {
  assert.deepEqual(await verifyPin("4242", "4242"), { ok: true, needsRehash: true });
  assert.deepEqual(await verifyPin("4243", "4242"), { ok: false, needsRehash: false });
  assert.deepEqual(await verifyPin("424", "4242"), { ok: false, needsRehash: false });
});

test("a hash with fewer iterations than today's is rehashed after a correct entry", async () => {
  const weak = await hashPin("9999", 1000);
  assert.deepEqual(await verifyPin("9999", weak), { ok: true, needsRehash: true });
  assert.deepEqual(await verifyPin("9998", weak), { ok: false, needsRehash: false });
});

test("a malformed or hostile stored hash is refused, not crashed on", async () => {
  const bad = [
    "pbkdf2-sha256$",
    "pbkdf2-sha256$abc$AAAA$AAAA",
    "pbkdf2-sha256$0$AAAA$AAAA",
    "pbkdf2-sha256$5000000$AAAA$AAAA", // above Workers' PBKDF2 limit
    "pbkdf2-sha256$1000$!!$AAAA",
    "pbkdf2-sha256$1000$AAAA$AAAA$extra",
  ];
  for (const stored of bad) {
    assert.deepEqual(await verifyPin("1234", stored), { ok: false, needsRehash: false }, stored);
  }
});

test("the PIN cookie is an HMAC token for one page, not the PIN, and it expires", async () => {
  const now = 1_800_000_000;
  const cookie = await pinCookieValue("secret", "page1", now + 3600);
  assert.match(cookie, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyPinCookie("secret", "page1", cookie, now), true);
  assert.equal(await verifyPinCookie("secret", "page2", cookie, now), false, "another page");
  assert.equal(await verifyPinCookie("other", "page1", cookie, now), false, "another secret");
  assert.equal(await verifyPinCookie("secret", "page1", cookie, now + 3600), false, "expired");
  // Moving the expiry breaks the MAC.
  const mac = cookie.split(".")[1];
  assert.equal(await verifyPinCookie("secret", "page1", `${now + 99999}.${mac}`, now), false);
  for (const value of [null, undefined, "", "4242", ".abc", "x.abc", `${now + 10}.`, `${now + 10}.!!`]) {
    assert.equal(await verifyPinCookie("secret", "page1", value, now), false, String(value));
  }
});

test("publish, MCP and the viewer store hashes and check cookie tokens", () => {
  const src = (f: string) => readFileSync(new URL(`../src/routes/${f}`, import.meta.url), "utf8");
  for (const f of ["api.ts", "mcp.ts"]) {
    assert.match(src(f), /pin: typeof pin === "string" && pin\.length > 0 \? await hashPin\(pin\) : null/, f);
  }
  const viewer = src("viewer.ts");
  assert.match(viewer, /await verifyPinCookie\(\s*c\.env\.SESSION_SECRET,\s*id,\s*getCookie\(c, `pin_\$\{id\}`\)/);
  assert.match(viewer, /const check = await verifyPin\(pin, metadata\.pin\);/);
  assert.match(viewer, /await pinCookieValue\(c\.env\.SESSION_SECRET, id, expSec\)/);
  assert.doesNotMatch(viewer, /pinCookie !== metadata\.pin|if \(pin !== metadata\.pin\)|=\$\{metadata\.pin\}/);
  // Nothing returns the stored PIN.
  assert.doesNotMatch(src("api.ts"), /pin: metadata\.pin/);
  assert.match(src("me.ts"), /hasPin: m\.pin !== null/);
});

test("verify-pin limits guesses, and the rehash and view-count writes don't undo each other", () => {
  const viewer = readFileSync(new URL("../src/routes/viewer.ts", import.meta.url), "utf8");
  // Guess limit keyed by page and hashed IP, checked before any PIN work.
  assert.match(viewer, /const keys = pinGuessKeys\(id, await hashToHex\(visitorNetwork\(ip\), 16\)\);/);
  assert.match(viewer, /underBurstLimit\(c\.env\.PIN_GUESS, keys\.visitor\)/);
  assert.match(viewer, /underBurstLimit\(c\.env\.PIN_GUESS_PAGE, keys\.page\)/);
  assert.ok(viewer.indexOf("c.env.PIN_GUESS") < viewer.indexOf("await verifyPin(pin, metadata.pin)"));
  // Rehash re-reads and skips gone, changed or already-hashed records.
  assert.match(viewer, /if \(fresh === null \|\| fresh\.pin !== metadata\.pin \|\| fresh\.pin === null \|\| isPinHash\(fresh\.pin\)\) return;/);
  assert.match(viewer, /serializeMetadata\(\{ \.\.\.fresh, pin: hashed \}\)/);
  // A view writes no KV at all (lib/view-counts.ts), so it can't undo a rehash.
  const view = viewer.slice(viewer.indexOf('viewer.get("/p/:id"'), viewer.indexOf('viewer.post("/p/:id/verify-pin"'));
  assert.ok(view.length > 0);
  assert.doesNotMatch(view, /PAGES_KV\.put/);
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /name = "PIN_GUESS"\s*\nnamespace_id = "1003"\s*\nsimple = \{ limit = 10, period = 60 \}/);
  assert.match(toml, /name = "PIN_GUESS_PAGE"\s*\nnamespace_id = "1004"\s*\nsimple = \{ limit = 60, period = 60 \}/);
});
