import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "./types.js";
import { api } from "./routes/api.js";
import { me } from "./routes/me.js";
import { viewer } from "./routes/viewer.js";
import { report } from "./routes/report.js";
import { handleMcp } from "./routes/mcp.js";
import { og } from "./routes/og.js";
import { auth } from "./routes/auth.js";
import { dashboard } from "./routes/dashboard.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { TIERS } from "./lib/rate-limit-tiers.js";

const app = new Hono<AppBindings>();

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error({
    event: "unhandled_error",
    timestamp: new Date().toISOString(),
    method: c.req.method,
    url: c.req.url,
    error: err.message,
    stack: err.stack,
  });
  return c.json({ error: "Internal Server Error" }, 500);
});

// Global middleware: CORS first, then auth
app.use("*", corsMiddleware);
app.use("*", authMiddleware);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// MCP Streamable HTTP endpoint
// POST is a publish/update mutation — rate-limited.
// Non-POST (initialize, tools/list, etc.) passes through without rate-limit.
app.post("/mcp", rateLimit(TIERS.anonymous), handleMcp);
app.on(["GET", "DELETE", "OPTIONS"], "/mcp", handleMcp);

// OG image route
app.route("/", og);

// Mount auth routes
app.route("/auth", auth);

// Mount me routes before api so /api/me/* matches first
app.route("/api/me", me);

// Mount API routes
app.route("/api", api);
app.route("/api", report);

// Mount dashboard route (authenticated HTML shell)
app.route("/", dashboard);

// Mount viewer routes
app.route("/", viewer);

// Static assets fallback — serve web/ files (index.html, style.css, app.js)
// Cloudflare ASSETS binding handles routing to the correct file.
app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: "Not found" }, 404);
});

export default app;
