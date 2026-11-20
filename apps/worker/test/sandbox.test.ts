import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPageHeaders } from "../src/middleware/security.ts";
import { injectEarlyScript, SANDBOX_SHIM } from "../src/lib/sandbox-shim.ts";

test("pages are sandboxed without allow-same-origin", () => {
  const headers = new Headers();
  applyPageHeaders(headers, { indexable: true });
  const csp = headers.get("Content-Security-Policy") ?? "";
  const sandbox = /(?:^|;\s*)sandbox ([^;]*)/.exec(csp);
  assert.ok(sandbox, `no sandbox directive in: ${csp}`);
  const flags = sandbox[1]!.split(/\s+/);
  assert.ok(flags.includes("allow-scripts"));
  assert.ok(flags.includes("allow-forms"));
  assert.ok(flags.includes("allow-popups-to-escape-sandbox"));
  assert.ok(!flags.includes("allow-same-origin"), "allow-same-origin would reopen the hole");
  assert.ok(!flags.some((f) => f.startsWith("allow-top-navigation")));
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

const S = "<script>S</script>";

test("early script goes right after <head>", () => {
  assert.equal(
    injectEarlyScript('<!DOCTYPE html><html><head lang="en"><title>x</title><script>page()</script></head></html>', S),
    `<!DOCTYPE html><html><head lang="en">${S}<title>x</title><script>page()</script></head></html>`,
  );
});

test("early script never lands before the doctype", () => {
  assert.equal(injectEarlyScript("<!doctype html><body>hi</body>", S), `<!doctype html>${S}<body>hi</body>`);
  assert.equal(injectEarlyScript('<html lang="en"><body/></html>', S), `<html lang="en">${S}<body/></html>`);
  assert.equal(injectEarlyScript("<h1>bare</h1>", S), `${S}<h1>bare</h1>`);
});

test("<header> is not mistaken for <head>", () => {
  assert.equal(injectEarlyScript("<body><header>x</header></body>", S), `${S}<body><header>x</header></body>`);
});

test("shim is a single self-contained script", () => {
  assert.ok(SANDBOX_SHIM.startsWith("<script>") && SANDBOX_SHIM.endsWith("</script>"));
  assert.equal(SANDBOX_SHIM.match(/<\/script>/g)?.length, 1);
  // The body must parse as JavaScript.
  new Function(SANDBOX_SHIM.slice("<script>".length, -"</script>".length));
});
