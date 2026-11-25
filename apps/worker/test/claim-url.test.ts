import { test } from "node:test";
import assert from "node:assert/strict";
import { claimUrl, parseClaimFragment } from "../src/lib/claim-url.ts";

const ID = "a1B2c3D4e5";
const TOKEN = "at_" + "Ab-_9".repeat(8) + "xyz"; // 43 base64url chars, like generateToken

test("claim link puts the id and token in the fragment", () => {
  const url = claimUrl("https://aired.sh", ID, TOKEN);
  assert.equal(url, `https://aired.sh/claim#${ID}.${TOKEN}`);
  const parsed = new URL(url);
  // Nothing secret in the path or query, which is what reaches server logs.
  assert.equal(parsed.pathname, "/claim");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, `#${ID}.${TOKEN}`);
});

test("claim link defaults to https://aired.sh and drops trailing slashes", () => {
  assert.equal(claimUrl(undefined, ID, TOKEN), `https://aired.sh/claim#${ID}.${TOKEN}`);
  assert.equal(claimUrl("", ID, TOKEN), `https://aired.sh/claim#${ID}.${TOKEN}`);
  assert.equal(claimUrl("http://localhost:8803//", ID, TOKEN), `http://localhost:8803/claim#${ID}.${TOKEN}`);
});

test("fragment round-trips through claimUrl", () => {
  const hash = new URL(claimUrl(undefined, ID, TOKEN)).hash;
  assert.deepEqual(parseClaimFragment(hash), { id: ID, token: TOKEN });
  assert.deepEqual(parseClaimFragment(hash.slice(1)), { id: ID, token: TOKEN });
});

test("fragment with a bad shape is rejected", () => {
  assert.equal(parseClaimFragment(""), null);
  assert.equal(parseClaimFragment("#"), null);
  assert.equal(parseClaimFragment(`#${ID}`), null); // no token
  assert.equal(parseClaimFragment(`#${ID}.`), null);
  assert.equal(parseClaimFragment(`#.${TOKEN}`), null); // no id
  assert.equal(parseClaimFragment(`#${ID}.${TOKEN.slice(3)}`), null); // missing at_ prefix
  assert.equal(parseClaimFragment(`#${ID}.at_short`), null);
  assert.equal(parseClaimFragment(`#${ID}.${TOKEN}.extra`), null); // '.' isn't base64url
  assert.equal(parseClaimFragment(`#abc/def.${TOKEN}`), null);
  assert.equal(parseClaimFragment(`#${ID}.${TOKEN}%20`), null);
  assert.equal(parseClaimFragment(`#${ID}.at_${"a".repeat(129)}`), null);
});
