import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ALERT_EVENTS, errorFields, log, logError, requestIdFrom, setLogSink } from "../src/lib/log.ts";
import { cachedHealth, checkHealth, publicReport, storageProbes } from "../src/lib/health.ts";

function record() {
  const lines: Array<{ method: string; entry: unknown }> = [];
  const sink = {
    log: (entry: unknown) => lines.push({ method: "log", entry }),
    warn: (entry: unknown) => lines.push({ method: "warn", entry }),
    error: (entry: unknown) => lines.push({ method: "error", entry }),
  };
  const prev = setLogSink(sink as unknown as Console);
  return { lines, restore: () => setLogSink(prev) };
}

test("log writes one object per call to the console method for its level", () => {
  const r = record();
  try {
    log("info", "a_thing", { n: 1 }, "req-1");
    log("warn", "b_thing");
    log("error", "c_thing", { x: "y" });
  } finally {
    r.restore();
  }
  assert.deepEqual(r.lines, [
    { method: "log", entry: { n: 1, requestId: "req-1", level: "info", event: "a_thing" } },
    { method: "warn", entry: { level: "warn", event: "b_thing" } },
    { method: "error", entry: { x: "y", level: "error", event: "c_thing" } },
  ]);
});

test("a field can't overwrite level or event", () => {
  const r = record();
  try {
    log("info", "real_event", { level: "error", event: "fake" });
  } finally {
    r.restore();
  }
  assert.deepEqual(r.lines[0]!.entry, { level: "info", event: "real_event" });
});

test("logError keeps the error's message, name and stack", () => {
  const r = record();
  let entry;
  try {
    entry = logError("x_failed", new TypeError("boom"), { id: 7 }, "rid");
  } finally {
    r.restore();
  }
  assert.equal(entry.error, "boom");
  assert.equal(entry.errorName, "TypeError");
  assert.match(String(entry.stack), /TypeError: boom/);
  assert.equal(entry.id, 7);
  assert.equal(entry.requestId, "rid");
  assert.equal(r.lines[0]!.method, "error");
  assert.deepEqual(errorFields("plain"), { error: "plain" });
});

test("the request id is Cloudflare's Ray ID when it looks like one, else a fresh id", () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { "cf-ray": v });
  assert.equal(requestIdFrom(h("8e1f2a3b4c5d6e7f-LHR"), () => "uuid"), "8e1f2a3b4c5d6e7f-LHR");
  assert.equal(requestIdFrom(h("8e1f2a3b4c5d6e7f"), () => "uuid"), "8e1f2a3b4c5d6e7f");
  assert.equal(requestIdFrom(h(), () => "uuid"), "uuid");
  assert.equal(requestIdFrom(h("<script>"), () => "uuid"), "uuid");
  assert.match(requestIdFrom(h()), /^[0-9a-f-]{36}$/);
});

test("every alert event is still logged somewhere in src", () => {
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) walk(u);
      else if (e.name.endsWith(".ts") && !e.name.endsWith("log.ts")) files.push(readFileSync(u, "utf8"));
    }
  };
  walk(new URL("../src/", import.meta.url));
  const src = files.join("\n");
  for (const event of ALERT_EVENTS) {
    assert.ok(src.includes(`"${event}"`) || src.includes(`'${event}'`), `${event} is never logged`);
  }
  const doc = readFileSync(new URL("../../../docs/observability.md", import.meta.url), "utf8");
  for (const event of ALERT_EVENTS) assert.ok(doc.includes(event), `docs/observability.md misses ${event}`);
});

test("health is ok only when every probe answers", async () => {
  const ok = await checkHealth({ kv: async () => null, d1: async () => 1 });
  assert.equal(ok.status, "ok");
  assert.equal(ok.checks.kv!.ok, true);

  const bad = await checkHealth({ kv: async () => null, d1: async () => { throw new Error("D1_ERROR"); } });
  assert.equal(bad.status, "degraded");
  assert.deepEqual({ ok: bad.checks.d1!.ok, error: bad.checks.d1!.error }, { ok: false, error: "D1_ERROR" });
  // Error text stays out of the public body.
  assert.deepEqual(Object.keys(publicReport(bad).checks.d1!), ["ok", "ms"]);
});

test("a probe that hangs fails at the timeout", async () => {
  const r = await checkHealth({ r2: () => new Promise(() => {}) }, { timeoutMs: 20 });
  assert.equal(r.status, "degraded");
  assert.match(r.checks.r2!.error!, /timed out/);
});

test("storageProbes reads one KV key, runs SELECT 1 and heads one R2 object", async () => {
  const calls: string[] = [];
  const probes = storageProbes({
    PAGES_KV: { get: async (k) => { calls.push(`kv:${k}`); return null; } },
    DB: { prepare: (sql) => ({ first: async () => { calls.push(`d1:${sql}`); return { 1: 1 }; } }) },
    PAGES_BUCKET: { head: async (k) => { calls.push(`r2:${k}`); return null; } },
  });
  const r = await checkHealth(probes);
  assert.equal(r.status, "ok");
  assert.deepEqual(calls.sort(), ["d1:SELECT 1", "kv:health:probe", "r2:health/probe"]);
});

test("health results are reused for the cache window", async () => {
  let t = 0;
  let runs = 0;
  const memo = cachedHealth(10_000, () => t);
  const run = async () => { runs++; return { status: "ok" as const, checks: {} }; };
  assert.equal(memo(run).fresh, true);
  t = 9_999;
  assert.equal(memo(run).fresh, false);
  t = 10_000;
  assert.equal(memo(run).fresh, true);
  assert.equal(runs, 2);
});

test("index.ts wires the request id first, health probes, and the scheduled error capture", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const rid = index.indexOf('app.use("*", requestIdMiddleware);');
  assert.ok(rid > 0 && rid < index.indexOf('app.use("*", corsMiddleware);'), "request id runs before CORS");
  assert.match(index, /checkHealth\(storageProbes\(c\.env\)\)/);
  assert.match(index, /ctx\.waitUntil\(runScheduled\(controller\.cron, env\)\)/);
  assert.match(index, /logError\("scheduled_failed", err, \{ cron, job \}\);\s*failure \?\?= err;/);
  assert.match(index, /if \(failure !== null\) throw failure;/);
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[observability\]\r?\nenabled = true/);
});
