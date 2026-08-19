import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { CSRF_HEADER } from "@aired/core";
import { requireCsrfHeader } from "./csrf.js";
import { SESSION_COOKIE_NAME } from "../lib/cookies.js";

function buildApp() {
  const app = new Hono();
  app.delete("/thing", requireCsrfHeader, (c) => c.json({ ok: true }));
  return app;
}

describe("requireCsrfHeader", () => {
  it("allows a mutating request with no cookie and no CSRF header (Bearer/token auth)", async () => {
    const app = buildApp();
    const res = await app.request("/thing", {
      method: "DELETE",
      headers: { Authorization: "Bearer at_sometoken" },
    });
    expect(res.status).toBe(200);
  });

  it("blocks a cookie-authenticated mutating request missing the CSRF header", async () => {
    const app = buildApp();
    const res = await app.request("/thing", {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=some.jwt.value` },
    });
    expect(res.status).toBe(403);
  });

  it("allows a cookie-authenticated mutating request that carries the CSRF header", async () => {
    const app = buildApp();
    const res = await app.request("/thing", {
      method: "DELETE",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=some.jwt.value`,
        [CSRF_HEADER]: "1",
      },
    });
    expect(res.status).toBe(200);
  });
});
