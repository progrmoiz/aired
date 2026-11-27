import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockedFieldName, looksLikeCardNumber, validateEntryKey, validateLiveData, validateRecord } from "../src/lib/collect-validate.ts";
import { csvCell, toCsv } from "../src/lib/collect-csv.ts";
import { collectRuntime, usesDataLayer } from "../src/lib/collect-runtime.ts";
import { COLLECT_LIMITS } from "../src/lib/collect-limits.ts";
import { collectPatchBody, changesPageSettings, responsesOut, responsesText } from "../src/lib/mcp-shapes.ts";

test("field names that ask for secrets are blocked; ordinary ones aren't", () => {
  for (const name of ["password", "Password", "userPassword", "new_password", "passwd", "cvv", "card_number", "cardNumber", "CC-Num", "ssn", "seedPhrase", "privateKey", "otp", "pin", "routing_number"]) {
    assert.ok(blockedFieldName(name), name);
  }
  for (const name of ["name", "email", "passport_photo", "spinning", "pinned", "answer", "card", "score", "phone", "workout", "opinion", "keyboard"]) {
    assert.ok(!blockedFieldName(name), name);
  }
});

test("card numbers are spotted by the Luhn check, not by length alone", () => {
  for (const v of ["4242424242424242", "4242 4242 4242 4242", "5555-5555-5555-4444", "378282246310005"]) assert.ok(looksLikeCardNumber(v), v);
  for (const v of ["4242424242424241", "1234567890123", "0000000000000000", "+1 415 555 0100", "2026-11-27", "12345"]) assert.ok(!looksLikeCardNumber(v), v);
});

test("record validation: objects only, bounded, JSON-safe", () => {
  assert.equal(validateRecord({ a: 1 }).ok, true);
  assert.equal(validateRecord({ a: { b: { c: { d: { e: 1 } } } } }).ok, true, "5 levels is fine");
  assert.equal(validateRecord({ a: { b: { c: { d: { e: { f: 1 } } } } } }).ok, false, "6 is not");
  assert.equal(validateRecord(null).ok, false);
  assert.equal(validateRecord("x").ok, false);
  assert.equal(validateRecord([]).ok, false);
  assert.equal(validateRecord({ n: Number.NaN }).ok, true, "JSON turns NaN into null");
  assert.equal(validateRecord({ list: Array.from({ length: 201 }, () => 1) }).ok, false);
  assert.equal(validateRecord(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 1]))).ok, false);
  assert.equal(validateRecord({ ["k".repeat(101)]: 1 }).ok, false);
  const nested = validateRecord({ answers: [{ q: 1, password: "x" }] });
  assert.equal(nested.ok, false);
  assert.equal(!nested.ok && nested.code, "blocked");
  const ok = validateRecord({ a: "é" });
  assert.ok(ok.ok && ok.size === new TextEncoder().encode('{"a":"é"}').byteLength);
});

test("live data takes any JSON up to the plan's size, secrets allowed (only the owner writes it)", () => {
  assert.equal(validateLiveData([1, 2, 3], 100).ok, true);
  assert.equal(validateLiveData("text", 100).ok, true);
  assert.equal(validateLiveData({ password: "fine here" }, 100).ok, true);
  assert.equal(validateLiveData(undefined, 100).ok, false);
  const big = validateLiveData({ s: "x".repeat(200) }, 100);
  assert.equal(!big.ok && big.code, "too_large");
});

test("entry keys are short and plain", () => {
  assert.deepEqual(validateEntryKey(undefined), { ok: true, key: null });
  assert.deepEqual(validateEntryKey("week:1.day-2_a"), { ok: true, key: "week:1.day-2_a" });
  for (const k of ["", " ", "a/b", "x".repeat(65), 3, {}]) assert.equal(validateEntryKey(k).ok, false, String(k));
});

test("CSV cells: quoting and formula prefixes", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  for (const v of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) assert.ok(csvCell(v).startsWith("'") || csvCell(v).startsWith(`"'`), v);
  const csv = toCsv([{ id: "r_x", viewer: "v", key: null, data: { id: "theirs", n: 2 }, createdAt: 0, updatedAt: 0 }]);
  assert.equal(csv.split("\r\n")[0], "id,viewer,key,created_at,updated_at,data.id,n", "a field named like a fixed column gets a prefix");
});

test("the runtime goes only into pages that name it, and its config can't break out of the script", () => {
  assert.ok(usesDataLayer("<script>aired.collect.save({})</script>"));
  assert.ok(usesDataLayer("aired . data .subscribe(f)"));
  assert.ok(!usesDataLayer("<p>We aired the collection on TV.</p>"));
  assert.ok(!usesDataLayer("myaired.collect"));
  const s = collectRuntime({ enabled: true, origin: "https://aired.test", id: "abc", token: "v1.abc.</script><script>alert(1)</script>.1.x", viewer: "v" });
  assert.equal(s.match(/<\/script>/g)?.length, 1, "only the closing tag");
  new Function(s.slice("<script>".length, -"</script>".length));
  const off = collectRuntime({ enabled: false, reason: "sign_in_required" });
  new Function(off.slice("<script>".length, -"</script>".length));
  assert.ok(!off.includes('"token"'), "no token in a page without an owner");
});

test("MCP shapes: get_responses output, CSV, and set_options' data-layer fields", () => {
  const out = responsesOut(
    {
      id: "abc", url: "https://aired.sh/p/abc", title: "Poll",
      settings: { public_results: true, closed: false },
      usage: { entries: 2, this_month: 2, limits: { responses_per_month: 300, stored_responses: 1000, stored_bytes: 2097152, retention_days: 90, live_data_bytes: 65536 } },
      responses: [{ id: "r_1", viewer: "v1", key: "vote", data: { choice: "=cmd" }, created_at: "2026-11-27T00:00:00.000Z", updated_at: "2026-11-27T00:00:00.000Z" }],
      cursor: null,
    },
    { csv: true },
  );
  assert.equal(out.public_results, true);
  assert.equal(out.accepting, true);
  assert.equal(out.limits.retention_days, 90);
  assert.match(out.csv ?? "", /'=cmd/);
  const text = responsesText(out);
  assert.match(text, /<untrusted_visitor_entries>[\s\S]*=cmd[\s\S]*<\/untrusted_visitor_entries>/);
  assert.ok(!text.includes("'=cmd"), "the CSV stays out of the text");
  const many = responsesOut({ responses: Array.from({ length: 200 }, (_, i) => ({ id: `r_${i}`, viewer: "v", data: { s: "x".repeat(400) }, created_at: "t", updated_at: "t" })) }, { csv: false });
  assert.ok(responsesText(many).length < 25_000, "capped");
  assert.equal(responsesOut({}, { csv: false }).csv, null);
  assert.deepEqual(collectPatchBody({ public_results: true, accept_responses: false }), { public_results: true, closed: true });
  assert.equal(collectPatchBody({}), null);
  assert.equal(changesPageSettings({ public_results: true }), false);
  assert.equal(changesPageSettings({ title: "x" }), true);
});

test("the docs give the limits the config has", () => {
  const read = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
  const { free, pro } = COLLECT_LIMITS;
  assert.deepEqual([free.responsesPerMonth, free.retentionDays, free.liveDataBytes], [300, 90, 64 * 1024]);
  assert.deepEqual([pro.responsesPerMonth, pro.retentionDays, pro.liveDataBytes], [10_000, null, 1024 * 1024]);
  for (const f of ["apps/web/docs.html", "apps/web/llms.txt", "apps/web/llms-full.txt", "apps/cli/SKILL.md"]) {
    const s = read(f);
    for (const want of ["aired.collect", "aired.data", "get_responses", "update_data", "300", "10,000", "90 days"]) assert.ok(s.includes(want), `${f} misses ${want}`);
  }
  for (const f of ["apps/web/docs.html", "apps/web/llms-full.txt"]) {
    const s = read(f);
    for (const want of ["/api/pages/:id/responses", "/api/pages/:id/data", "data-aired-notice", "sign_in_required"]) assert.ok(s.includes(want), `${f} misses ${want}`);
  }
  const privacy = read("apps/web/privacy.html");
  for (const want of ["aired_v", "When a page saves what you enter", "Everything visitors saved on your pages is deleted"]) assert.ok(privacy.includes(want), want);
  assert.ok(read("apps/web/terms.html").includes('id="collecting"'));
});
