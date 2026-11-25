import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyStripeSignature } from "../src/lib/billing/signature.ts";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';
const T = 1_750_000_000;

// Computed here, independently of the module under test.
async function sign(payload: string, t: number, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

test("a correctly signed event is accepted", async () => {
  const v1 = await sign(BODY, T);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, SECRET, T), true);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, SECRET, T + 299), true);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, SECRET, T - 300), true);
});

test("any v1 may match, and v0 is ignored", async () => {
  const v1 = await sign(BODY, T);
  const other = await sign(BODY, T, "whsec_old_secret");
  const header = `t=${T},v1=${other},v1=${v1},v0=deadbeef`;
  assert.equal(await verifyStripeSignature(BODY, header, SECRET, T), true);
  assert.equal(await verifyStripeSignature(BODY, ` t=${T} , v1=${v1} `, SECRET, T), true);
});

test("a wrong secret or a tampered body is rejected", async () => {
  const v1 = await sign(BODY, T);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, "whsec_wrong", T), false);
  assert.equal(await verifyStripeSignature(BODY + " ", `t=${T},v1=${v1}`, SECRET, T), false);
  // Signed for another timestamp.
  assert.equal(await verifyStripeSignature(BODY, `t=${T + 1},v1=${v1}`, SECRET, T), false);
  // Only a v0 that matches is not enough.
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v0=${v1}`, SECRET, T), false);
});

test("a stale or future timestamp is rejected", async () => {
  const v1 = await sign(BODY, T);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, SECRET, T + 301), false);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, SECRET, T - 301), false);
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, SECRET, T + 1000, 2000), true);
});

test("malformed headers are rejected without throwing", async () => {
  const v1 = await sign(BODY, T);
  const bad: Array<string | null | undefined> = [
    null,
    undefined,
    "",
    `v1=${v1}`,
    `t=${T}`,
    `t=${T},v1=`,
    `t=abc,v1=${v1}`,
    `t=${T}x,v1=${v1}`,
    `t=,v1=${v1}`,
    `t=${T},v1=${v1.slice(0, -2)}`,
    `t=${T},v1=${v1.toUpperCase()}`,
    `t=${T},v1=${"z".repeat(64)}`,
    "garbage",
    ",,,=,=",
  ];
  for (const header of bad) {
    assert.equal(await verifyStripeSignature(BODY, header, SECRET, T), false, String(header));
  }
  assert.equal(await verifyStripeSignature(BODY, `t=${T},v1=${v1}`, "", T), false);
});
