import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/d1.ts";
import {
  FEEDBACK_PER_DAY,
  FEEDBACK_PER_HOUR,
  feedbackAllowed,
  feedbackId,
  insertFeedback,
  listFeedback,
  parseFeedback,
  type FeedbackInput,
} from "../src/lib/feedback.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const good = { kind: "friction", message: "set_options needed the update token twice" };

const input = (over: Partial<FeedbackInput> = {}): FeedbackInput => {
  const r = parseFeedback(good);
  assert.ok(r.ok);
  return { ...r.input, ...over };
};

test("feedback takes a kind, an impact, a message and a page id, with defaults", () => {
  const r = parseFeedback({ ...good, impact: "blocked", page_id: "aB3_x", tool: "set_options", client: "claude-code/2.1", source: "mcp" });
  assert.ok(r.ok);
  assert.deepEqual(r.input, {
    kind: "friction",
    impact: "blocked",
    message: good.message,
    pageId: "aB3_x",
    tool: "set_options",
    source: "mcp",
    client: "claude-code/2.1",
    actor: "agent",
  });
  const bare = parseFeedback(good);
  assert.ok(bare.ok);
  assert.equal(bare.input.impact, null);
  assert.equal(bare.input.source, "api");
});

test("bad feedback is refused with a reason", () => {
  const no = (body: unknown, re: RegExp) => {
    const r = parseFeedback(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    if (!r.ok) assert.match(r.error, re);
  };
  no({ ...good, kind: "praise" }, /kind must be one of: bug, friction, idea/);
  no({ message: good.message }, /kind must be/);
  no({ ...good, impact: "huge" }, /impact must be one of/);
  no({ ...good, message: "too short" }, /10 to 2000/);
  no({ ...good, message: "x".repeat(2001) }, /10 to 2000/);
  no({ ...good, message: 42 }, /message is required/);
  no({ ...good, page_id: "../etc" }, /page_id must be a page id/);
  no({ ...good, tool: "x".repeat(101) }, /at most 100/);
  no({ ...good, source: "email" }, /source must be/);
  no({ ...good, actor: "robot" }, /actor must be/);
  no(null, /JSON object/);
  // Terminal escapes would reach the owner's terminal through scripts/feedback.mjs.
  no({ ...good, message: "looks fine \u001b]52;c;aGk=\u0007 here" }, /control characters/);
  no({ ...good, message: "bell \u0007 in the middle of it" }, /control characters/);
  assert.ok(parseFeedback({ ...good, message: "line one\nline two\ttabbed" }).ok, "line breaks and tabs are fine");
});

test("page HTML is never taken as feedback", () => {
  for (const html of ["<!DOCTYPE html><html><body>hi</body></html>", "it broke on <html lang=en> pages", "see <script>alert(1)</script> here", "<style>body{}</style> is ignored"]) {
    const r = parseFeedback({ ...good, message: html });
    assert.equal(r.ok, false, html);
    if (!r.ok) assert.match(r.error, /Don't send page HTML/);
  }
  // Mentioning a tag in prose is fine.
  assert.ok(parseFeedback({ ...good, message: "the <title> tag was ignored by publish" }).ok);
});

test("ids are fb_ and 10 characters", () => {
  const ids = new Set(Array.from({ length: 50 }, feedbackId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^fb_[0-9a-z]{10}$/);
});

test("feedback is stored, signed in or anonymous, and read back newest first", async () => {
  const { db } = fakeD1();
  assert.equal(await insertFeedback(db, "fb_1", input({ pageId: "p1" }), { userId: null, rateKey: "ip1" }, NOW - 2000), true);
  assert.equal(await insertFeedback(db, "fb_2", input({ kind: "bug", impact: "blocked" }), { userId: 7, rateKey: "u7" }, NOW - 1000), true);
  const rows = await listFeedback(db, { limit: 10 });
  assert.deepEqual(rows.map((r) => r.id), ["fb_2", "fb_1"]);
  assert.equal(rows[0]!.user_id, 7);
  assert.equal(rows[1]!.user_id, null);
  assert.equal(rows[1]!.page_id, "p1");
  assert.ok(!("rate_key" in rows[0]!), "the rate key isn't shown");
  assert.deepEqual((await listFeedback(db, { limit: 10, kind: "bug" })).map((r) => r.id), ["fb_2"]);
  assert.deepEqual((await listFeedback(db, { limit: 10, before: NOW - 1000 })).map((r) => r.id), ["fb_1"]);
});

test("each caller gets 10 an hour, enforced by the insert itself; the next hour opens again", async () => {
  const { db } = fakeD1();
  for (let i = 0; i < FEEDBACK_PER_HOUR; i++) {
    assert.equal(await insertFeedback(db, `fb_${i}`, input(), { userId: null, rateKey: "ip1" }, NOW - 1000 * i), true, `send ${i + 1}`);
  }
  assert.equal(await insertFeedback(db, "fb_over", input(), { userId: null, rateKey: "ip1" }, NOW), false, "the 11th isn't stored");
  assert.equal((await listFeedback(db, { limit: 50 })).length, FEEDBACK_PER_HOUR);
  assert.deepEqual(await feedbackAllowed(db, "ip1", NOW), { ok: false, reason: "caller" });
  // Someone else isn't affected.
  assert.deepEqual(await feedbackAllowed(db, "ip2", NOW), { ok: true });
  // An hour after the oldest, one slot is free again.
  assert.deepEqual(await feedbackAllowed(db, "ip1", NOW + 3600_000 - 1000 * (FEEDBACK_PER_HOUR - 1)), { ok: true });
});

test("everyone together is capped per day", async () => {
  const { db, raw } = fakeD1();
  const insert = raw.prepare(
    "INSERT INTO agent_feedback (id, kind, message, source, actor, rate_key, created_at) VALUES (?, 'idea', 'a message here', 'api', 'agent', ?, ?)",
  );
  for (let i = 0; i < FEEDBACK_PER_DAY; i++) insert.run(`fb_${i}`, `k${i}`, NOW - 60_000);
  assert.deepEqual(await feedbackAllowed(db, "fresh", NOW), { ok: false, reason: "global" });
  assert.equal(await insertFeedback(db, "fb_fresh", input(), { userId: null, rateKey: "fresh" }, NOW), false);
  assert.deepEqual(await feedbackAllowed(db, "fresh", NOW + 86400_000), { ok: true });
});

test("wiring: the route checks the limit before writing, keys it by account or IP, and answers the id", () => {
  const api = readFileSync(new URL("../src/routes/api.ts", import.meta.url), "utf8");
  const route = api.slice(api.indexOf('api.post("/feedback"'), api.indexOf('// GET /api/pages/:id — public metadata'));
  // IPv6 senders count by /64; the in-memory limit stops floods before D1.
  assert.match(route, /hashToHex\(user !== null \? `user:\$\{user\.id\}` : `ip:\$\{visitorNetwork\(ip\)\}`, 16\)/);
  assert.match(api, /api\.post\("\/feedback", rateLimit\(TIERS\.feedback\), async/);
  assert.match(route, /if \(!\(await insertFeedback\([\s\S]*?429/);
  assert.match(route, /return c\.json\(\{ id, message: `\$\{NOT_SUPPORT\} Tell the user you sent feedback \$\{id\}\.` \}\);/);
  // The log line never carries the message.
  assert.doesNotMatch(route, /feedback_received[^\n]*message/);
  const admin = readFileSync(new URL("../src/routes/admin.ts", import.meta.url), "utf8");
  assert.match(admin, /admin\.get\("\/feedback"/);
  assert.ok(admin.indexOf('admin.use("*"') < admin.indexOf('admin.get("/feedback"'), "behind the admin token");
});
