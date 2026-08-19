import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppBindings, Env } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { api } from "./api.js";
import { MemoryBucket, MemoryKV, noopExecutionContext } from "../test/mock-bindings.js";

// Regression coverage for the DELETE/PUT /api/pages/:id 403 bug: a freshly
// published page's update_token, sent as `Authorization: Bearer <token>`
// with no X-Aired-Request/CSRF header (exactly what the CLI and raw curl
// send for anonymous, non-JWT publishes), was rejected by the CSRF
// middleware before the token was ever checked. See
// data/visual-publishing-research-s1/report.md for the live-service
// evidence that led to this fix.

function buildApp() {
  const app = new Hono<AppBindings>();
  app.use("*", authMiddleware);
  app.route("/api", api);
  return app;
}

function buildEnv(): Env {
  return {
    PAGES_KV: new MemoryKV(),
    PAGES_BUCKET: new MemoryBucket(),
    ASSETS: undefined as unknown as Fetcher,
    SESSION_SECRET: "test-session-secret",
    SESSION_VALID_SINCE: "1970-01-01T00:00:00Z",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
  } as unknown as Env;
}

async function publish(app: Hono<AppBindings>, env: Env, html = "<h1>hi</h1>") {
  const res = await app.request(
    "/api/publish",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html }),
    },
    env,
    noopExecutionContext,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; update_token: string };
}

describe("DELETE /api/pages/:id with a valid Bearer update_token", () => {
  it("succeeds without a CSRF header (anonymous CLI/curl flow)", async () => {
    const app = buildApp();
    const env = buildEnv();
    const { id, update_token } = await publish(app, env);

    const res = await app.request(
      `/api/pages/${id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${update_token}` },
      },
      env,
      noopExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("still rejects an invalid token with 403", async () => {
    const app = buildApp();
    const env = buildEnv();
    const { id } = await publish(app, env);

    const res = await app.request(
      `/api/pages/${id}`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer at_not-the-right-token" },
      },
      env,
      noopExecutionContext,
    );

    expect(res.status).toBe(403);
  });
});

describe("PUT /api/pages/:id with a valid update_token", () => {
  it("succeeds without a CSRF header (anonymous CLI/curl flow)", async () => {
    const app = buildApp();
    const env = buildEnv();
    const { id, update_token } = await publish(app, env);

    const res = await app.request(
      `/api/pages/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<h1>updated</h1>", update_token }),
      },
      env,
      noopExecutionContext,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; update_token: string };
    expect(body.id).toBe(id);
  });

  it("still rejects an invalid token with 403", async () => {
    const app = buildApp();
    const env = buildEnv();
    const { id } = await publish(app, env);

    const res = await app.request(
      `/api/pages/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: "<h1>nope</h1>", update_token: "at_wrong" }),
      },
      env,
      noopExecutionContext,
    );

    expect(res.status).toBe(403);
  });
});
