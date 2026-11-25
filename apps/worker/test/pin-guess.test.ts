import { test } from "node:test";
import assert from "node:assert/strict";
import { pinGuessKeys, visitorNetwork } from "../src/lib/pin-guess.ts";

test("IPv4 visitors are keyed by their address", () => {
  assert.equal(visitorNetwork("203.0.113.7"), "203.0.113.7");
});

test("IPv6 visitors are keyed by their /64, however the address is written", () => {
  const net = "2001:db8:1:2::/64";
  for (const ip of [
    "2001:db8:1:2::1",
    "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
    "2001:0db8:0001:0002:0000:0000:0000:0042",
    "2001:DB8:1:2::FFFF",
  ]) {
    assert.equal(visitorNetwork(ip), net, ip);
  }
  assert.notEqual(visitorNetwork("2001:db8:1:3::1"), net);
  assert.equal(visitorNetwork("::1"), "0:0:0:0::/64");
  assert.equal(visitorNetwork("2001:db8::"), "2001:db8:0:0::/64");
});

test("guess keys: one per page and visitor, one per page", () => {
  assert.deepEqual(pinGuessKeys("abc", "h1"), { visitor: "abc:h1", page: "page:abc" });
});
