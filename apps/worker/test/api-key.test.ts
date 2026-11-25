import { test } from "node:test";
import assert from "node:assert/strict";
import { API_KEY_LENGTH, API_KEY_PREFIX, apiKeyDisplayPrefix, crc32, generateApiKey, parseApiKey } from "../../../packages/core/src/api-key.ts";

test("a generated key is aired_sk_ + 32 base62 characters + a 6-character checksum, and parses", () => {
  for (let i = 0; i < 200; i++) {
    const key = generateApiKey();
    assert.equal(key.length, API_KEY_LENGTH);
    assert.ok(key.startsWith(API_KEY_PREFIX));
    assert.match(key, /^aired_sk_[0-9A-Za-z]{38}$/);
    assert.deepEqual(parseApiKey(key), { ok: true, key });
  }
});

test("keys are random", () => {
  const keys = new Set(Array.from({ length: 500 }, generateApiKey));
  assert.equal(keys.size, 500);
});

test("one changed character in the body or checksum fails without a lookup", () => {
  const key = generateApiKey();
  for (const i of [API_KEY_PREFIX.length, API_KEY_PREFIX.length + 10, key.length - 1]) {
    const c = key[i] === "a" ? "b" : "a";
    const bad = key.slice(0, i) + c + key.slice(i + 1);
    assert.deepEqual(parseApiKey(bad), { ok: false }, `changed index ${i}`);
  }
});

test("wrong prefix, length or alphabet is refused", () => {
  const key = generateApiKey();
  for (const bad of [
    key.replace("aired_sk_", "aired_pk_"),
    key.slice(0, -1),
    key + "A",
    key.slice(0, 12) + "-" + key.slice(13),
    "at_" + key.slice(9),
    "",
    null,
    42,
  ]) {
    assert.deepEqual(parseApiKey(bad), { ok: false }, String(bad));
  }
});

test("update tokens are never mistaken for keys", () => {
  // Update tokens look like at_ + 43 base64url characters.
  assert.deepEqual(parseApiKey("at_" + "A".repeat(43)), { ok: false });
});

test("the display prefix shows only the start of the key", () => {
  const key = generateApiKey();
  assert.equal(apiKeyDisplayPrefix(key), key.slice(0, 13));
  assert.ok(!apiKeyDisplayPrefix(key).includes(key.slice(-6)), "never includes the checksum");
});

// Known answers: if the checksum ever changed, every key already issued would
// be refused before the lookup. These pin it.
test("crc32 matches the standard check value", () => {
  assert.equal(crc32("123456789"), 0xcbf43926);
  assert.equal(crc32("0".repeat(32)), 0xa0f292d0);
});

test("a fixed key parses, so issued keys keep working", () => {
  const fixed = "aired_sk_000000000000000000000000000000002wjyrI";
  assert.deepEqual(parseApiKey(fixed), { ok: true, key: fixed });
  assert.deepEqual(parseApiKey(fixed.slice(0, -1) + "J"), { ok: false });
});
