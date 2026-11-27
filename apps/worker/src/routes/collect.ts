import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { hashToHex } from "@aired/core";
import { pageGate, usableSecret, verifyViewerToken, verifyWatchToken } from "../lib/collect-token.ts";
import { gateMaterial } from "../lib/access-list.ts";
import { getAccessEntries } from "../lib/access-store.ts";

import { bodyLimit } from "hono/body-limit";
import { parseMetadata } from "@aired/core";
import { validateEntryKey, validateRecord } from "../lib/collect-validate.ts";
import {
  getLiveData,
  getPageData,
  listEntries,
  liveDataVersion,
  removeOwnEntry,
  saveEntry,
  type Entry,
} from "../lib/collect-store.ts";
import { COLLECT_WRITE_LIMITS, READ_PAGE_MAX } from "../lib/collect-limits.ts";
import { takeDurableSlot } from "../lib/durable-limit.ts";
import { getEntitlements } from "../lib/entitlements.js";
import { loadPage } from "../lib/page-write.ts";
import { visitorNetwork } from "../lib/pin-guess.js";
import { log } from "../lib/log.ts";
import { underBurstLimit } from "../lib/burst-limit.js";

/**
 * The page's gate as tokens are tied to it: the PIN, and for an "only these
 * people" page the list too (lib/access-list.ts gateMaterial), so a token
 * from before a mode or list change stops working. Throws on a D1 error.
 */
async function currentGate(c: Context<AppBindings>, id: string, pin: string | null, access: "people" | null | undefined): Promise<string> {
  const entries = access === "people" ? await getAccessEntries(c.env.DB, id) : [];
  return pageGate(c.env.SESSION_SECRET, id, gateMaterial(pin, access, entries));
}

/**
 * The calls a published page makes through window.aired
 * (lib/collect-runtime.ts): POST /c/:id/{save,mine,all,remove,data}.
 *
 * Each body is JSON sent as text/plain (a simple CORS request from the
 * page's opaque origin, no preflight) and carries the viewer token
 * (lib/collect-token.ts). The token decides who the viewer is; nothing the
 * page sends can name another viewer or another page. No cookies are read.
 *
 * - save: add an entry (or replace this viewer's entry under a key). Only
 *   pages with an owner; refused when closed, over the plan's caps
 *   (lib/collect-limits.ts), over the write limits, or when it looks like
 *   a password or card harvest (lib/collect-validate.ts).
 * - mine: this viewer's entries. all: everyone's, only when the owner made
 *   results public, and without viewer ids. remove: one of this viewer's own.
 * - data: the live data an owner pushed with update_data, or "unchanged"
 *   when the page already has this version.
 *
 * Answers carry Access-Control-Allow-Origin: * and never credentials.
 */
const collect = new Hono<AppBindings>();

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BODY_MAX = 16 * 1024;

type Problem = { status: 400 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 503; code: string; error: string };

function problem(c: Context<AppBindings>, p: Problem): Response {
  return c.json({ error: p.error, code: p.code }, p.status);
}

/** An entry as a page sees it: never the viewer key of anyone else. */
function viewerEntry(e: Entry, viewer: string) {
  return { id: e.id, key: e.key, data: e.data, created_at: new Date(e.createdAt).toISOString(), updated_at: new Date(e.updatedAt).toISOString(), mine: e.viewer === viewer };
}

async function readBody(c: Context<AppBindings>): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; problem: Problem }> {
  const tooLarge: Problem = { status: 413, code: "too_large", error: "Request body too large." };
  if (Number(c.req.header("Content-Length") ?? "0") > BODY_MAX) return { ok: false, problem: tooLarge };
  const text = await c.req.text();
  if (text.length > BODY_MAX) return { ok: false, problem: tooLarge };
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return { ok: true, body: v as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { ok: false, problem: { status: 400, code: "invalid_json", error: "Send a JSON object." } };
}

const TOKEN_PROBLEMS: Record<string, Problem> = {
  expired: { status: 403, code: "expired", error: "This page has been open too long. Reload it to keep saving." },
  default: { status: 403, code: "forbidden", error: "Reload the page and try again." },
};

type Caller = { id: string; viewer: string; gate: string; body: Record<string, unknown> };

async function caller(c: Context<AppBindings>): Promise<Caller | Response> {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return problem(c, { status: 404, code: "not_found", error: "Page not found" });
  // A per-minute flood guard on every call, reads included (wrangler.toml COLLECT_BURST).
  const network = await hashToHex(visitorNetwork(c.req.header("CF-Connecting-IP") ?? "unknown"), 16);
  if (!(await underBurstLimit(c.env.COLLECT_BURST, `${network}`))) {
    c.header("Retry-After", "60");
    return problem(c, { status: 429, code: "rate_limited", error: "Too many requests. Wait a minute and try again." });
  }
  if (!usableSecret(c.env.SESSION_SECRET)) return problem(c, { status: 503, code: "unavailable", error: "Saving isn't set up on this server." });
  const read = await readBody(c);
  if (!read.ok) return problem(c, read.problem);
  const check = await verifyViewerToken(c.env.SESSION_SECRET, id, read.body.token, Math.floor(Date.now() / 1000));
  if (!check.ok) return problem(c, TOKEN_PROBLEMS[check.reason] ?? TOKEN_PROBLEMS.default!);
  return { id, viewer: check.viewer, gate: check.gate, body: read.body };
}

const PIN_CHANGED: Problem = { status: 403, code: "expired", error: "This page's access changed. Reload it to keep going." };

/**
 * The live page and its owner, for this caller; a Response when it's gone,
 * has no owner, has used up its view limit, or its PIN changed since the
 * token was minted.
 */
async function ownedPage(c: Context<AppBindings>, who: Caller): Promise<{ ownerId: number } | Response> {
  const id = who.id;
  let page: Awaited<ReturnType<typeof loadPage>>;
  try {
    page = await loadPage(c.env, id);
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't reach storage. Try again." });
  }
  if (page === null) return problem(c, { status: 410, code: "gone", error: "This page is gone." });
  if (page.row.ownerId === null) {
    return problem(c, { status: 403, code: "sign_in_required", error: "Only pages published from an aired account can save data." });
  }
  if (page.row.reads !== null && (page.kv?.readCount ?? 0) >= page.row.reads) return problem(c, { status: 410, code: "gone", error: "This page is gone." });
  let gate: string;
  try {
    gate = await currentGate(c, id, page.row.pin, page.row.access);
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't reach storage. Try again." });
  }
  if (gate !== who.gate) return problem(c, PIN_CHANGED);
  return { ownerId: page.row.ownerId };
}

/** The three write limits; a Response when one is used up or can't be checked. */
async function writeAllowed(c: Context<AppBindings>, id: string, viewer: string): Promise<Response | null> {
  const ip = await hashToHex(visitorNetwork(c.req.header("CF-Connecting-IP") ?? "unknown"), 16);
  const now = Date.now();
  try {
    for (const [bucket, rule] of [
      [`collect:v:${id}:${viewer}`, COLLECT_WRITE_LIMITS.viewer],
      [`collect:np:${id}:${ip}`, COLLECT_WRITE_LIMITS.networkPage],
      [`collect:ip:${ip}`, COLLECT_WRITE_LIMITS.ip],
      [`collect:p:${id}`, COLLECT_WRITE_LIMITS.page],
    ] as const) {
      if (!(await takeDurableSlot(c.env.DB, bucket, rule, now))) {
        c.header("Retry-After", "60");
        return problem(c, { status: 429, code: "rate_limited", error: "Too many saves. Wait a minute and try again." });
      }
    }
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't save right now. Try again." });
  }
  return null;
}

// The 16 KB cap on bodies, streamed: a body sent without Content-Length stops there too.
collect.use("/c/*", bodyLimit({ maxSize: BODY_MAX, onError: (c) => c.json({ error: "Request body too large.", code: "too_large" }, 413) }));

collect.use("/c/*", async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.delete("Access-Control-Allow-Credentials");
  c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("X-Robots-Tag", "noindex");
});

collect.post("/c/:id/save", async (c) => {
  const who = await caller(c);
  if (who instanceof Response) return who;
  const page = await ownedPage(c, who);
  if (page instanceof Response) return page;

  const record = validateRecord(who.body.record);
  if (!record.ok) {
    if (record.code === "blocked") log("warn", "collect_blocked", { pageId: who.id, ownerId: page.ownerId });
    return problem(c, { status: record.code === "too_large" ? 413 : 422, code: record.code, error: record.error });
  }
  const key = validateEntryKey(who.body.key);
  if (!key.ok) return problem(c, { status: 422, code: key.code, error: key.error });

  const limited = await writeAllowed(c, who.id, who.viewer);
  if (limited) return limited;

  const ent = await getEntitlements(c.env, page.ownerId);
  let saved: Awaited<ReturnType<typeof saveEntry>>;
  try {
    saved = await saveEntry(c.env.DB, {
      pageId: who.id, ownerId: page.ownerId, viewer: who.viewer, key: key.key, json: record.json, size: record.size, limits: ent.collect, now: Date.now(),
    });
  } catch (err) {
    console.error("collect save failed", { id: who.id, err: String(err) });
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't save right now. Try again." });
  }
  if (!saved.ok) {
    if (saved.reason === "closed") return problem(c, { status: 409, code: "closed", error: "This page isn't taking new entries." });
    log("info", "collect_limit", { pageId: who.id, ownerId: page.ownerId, reason: saved.reason, plan: ent.plan });
    return problem(c, { status: 409, code: "limit", error: "This page can't take more entries right now. Its owner has been told." });
  }
  return c.json({ entry: viewerEntry(saved.entry, who.viewer), replaced: saved.replaced });
});

collect.post("/c/:id/mine", async (c) => {
  const who = await caller(c);
  if (who instanceof Response) return who;
  const page = await ownedPage(c, who);
  if (page instanceof Response) return page;
  const { entries } = await listEntries(c.env.DB, who.id, { viewer: who.viewer, limit: READ_PAGE_MAX, cursor: null });
  return c.json({ entries: entries.map((e) => viewerEntry(e, who.viewer)) });
});

collect.post("/c/:id/all", async (c) => {
  const who = await caller(c);
  if (who instanceof Response) return who;
  const page = await ownedPage(c, who);
  if (page instanceof Response) return page;
  const settings = await getPageData(c.env.DB, who.id);
  if (!settings?.publicResults) {
    return problem(c, { status: 403, code: "private", error: "Only the page's owner can see everyone's entries. They can make results public." });
  }
  const { entries } = await listEntries(c.env.DB, who.id, { viewer: null, limit: READ_PAGE_MAX, cursor: null });
  return c.json({ entries: entries.map((e) => viewerEntry(e, who.viewer)) });
});

collect.post("/c/:id/remove", async (c) => {
  const who = await caller(c);
  if (who instanceof Response) return who;
  const page = await ownedPage(c, who);
  if (page instanceof Response) return page;
  const target = who.body.id;
  if (typeof target !== "string" || target === "" || target.length > 64) {
    return problem(c, { status: 422, code: "invalid_record", error: "remove() takes an entry id or key." });
  }
  const limited = await writeAllowed(c, who.id, who.viewer);
  if (limited) return limited;
  const removed = await removeOwnEntry(c.env.DB, who.id, who.viewer, target, Date.now());
  return c.json({ removed });
});

// Polled every LIVE_DATA_POLL_SECONDS by pages that subscribe. Cheap on
// purpose: the token, the KV record (gone once the page is deleted or
// expired) and one small row. Pages without an owner have no data.
collect.post("/c/:id/data", async (c) => {
  const who = await caller(c);
  if (who instanceof Response) return who;
  const raw = await c.env.PAGES_KV.get(`page:${who.id}`);
  const live = raw === null ? null : parseMetadata(raw);
  if (live === null || (live.reads !== null && live.readCount >= live.reads)) return problem(c, { status: 410, code: "gone", error: "This page is gone." });
  let gate: string;
  try {
    gate = await currentGate(c, who.id, live.pin, live.access);
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't reach storage. Try again." });
  }
  if (gate !== who.gate) return problem(c, PIN_CHANGED);
  const since = typeof who.body.since === "number" ? who.body.since : -1;
  try {
    if (since >= 0 && (await liveDataVersion(c.env.DB, who.id)) === since) return c.json({ version: since, changed: false });
    const data = await getLiveData(c.env.DB, who.id);
    return c.json({ version: data.version, data: data.data, updated_at: data.updatedAt === null ? null : new Date(data.updatedAt).toISOString() });
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't load the data. Try again." });
  }
});

// Live reload (lib/live-reload.ts): an open page asks every few seconds
// whether the HTML it was served is still the live one. Body: { token, etag }
// with the watch token the page got. Answers { changed }. Cheap: the token,
// the KV record, the gate and an R2 head. Its own per-minute guard
// (LIVE_BURST), so a room full of viewers can't use up the data layer's.
collect.post("/c/:id/live", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!PAGE_ID.test(id)) return problem(c, { status: 404, code: "not_found", error: "Page not found" });
  const network = await hashToHex(visitorNetwork(c.req.header("CF-Connecting-IP") ?? "unknown"), 16);
  if (!(await underBurstLimit(c.env.LIVE_BURST, network))) {
    c.header("Retry-After", "60");
    return problem(c, { status: 429, code: "rate_limited", error: "Too many requests. Wait a minute and try again." });
  }
  if (!usableSecret(c.env.SESSION_SECRET)) return problem(c, { status: 503, code: "unavailable", error: "Live reload isn't set up on this server." });
  const read = await readBody(c);
  if (!read.ok) return problem(c, read.problem);
  const check = await verifyWatchToken(c.env.SESSION_SECRET, id, read.body.token, Math.floor(Date.now() / 1000));
  if (!check.ok) return problem(c, TOKEN_PROBLEMS[check.reason] ?? TOKEN_PROBLEMS.default!);
  const etag = read.body.etag;
  if (typeof etag !== "string" || etag === "" || etag.length > 100) return problem(c, { status: 400, code: "invalid_input", error: "Send the etag the page was served with." });
  const raw = await c.env.PAGES_KV.get(`page:${id}`);
  const live = raw === null ? null : parseMetadata(raw);
  if (live === null || (live.reads !== null && live.readCount >= live.reads)) return problem(c, { status: 410, code: "gone", error: "This page is gone." });
  if (live.expiresAt !== null && Date.parse(live.expiresAt) <= Date.now()) return problem(c, { status: 410, code: "gone", error: "This page is gone." });
  let gate: string;
  try {
    gate = await currentGate(c, id, live.pin, live.access);
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't reach storage. Try again." });
  }
  if (gate !== check.gate) return problem(c, PIN_CHANGED);
  let head: R2Object | null;
  try {
    head = await c.env.PAGES_BUCKET.head(`pages/${id}/index.html`);
  } catch {
    return problem(c, { status: 503, code: "unavailable", error: "Couldn't reach storage. Try again." });
  }
  if (head === null) return problem(c, { status: 410, code: "gone", error: "This page is gone." });
  return c.json({ changed: head.etag !== etag });
});

collect.on(["GET", "PUT", "PATCH", "DELETE"], "/c/:id/:op", (c) =>
  problem(c, { status: 404, code: "not_found", error: "Use POST." }),
);

export { collect };
