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
import { billing, upgrade } from "./routes/billing.js";
import { publishRateLimit } from "./middleware/rate-limit.js";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { isMcpToolCall } from "./lib/mcp-rpc.js";

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
// Every JSON-RPC message is a POST, so only tool calls (publishes) are
// rate-limited; initialize, tools/list and notifications pass through.
app.post(
  "/mcp",
  async (c, next) => {
    let body: unknown = null;
    try {
      body = await c.req.raw.clone().json();
    } catch {
      // Malformed body: let the MCP handler return the JSON-RPC error.
    }
    if (isMcpToolCall(body)) return publishRateLimit(c, next);
    await next();
  },
  handleMcp,
);
app.on(["GET", "DELETE", "OPTIONS"], "/mcp", handleMcp);

// OG image route
app.route("/", og);

// Mount auth routes
app.route("/auth", auth);

// Mount billing routes before api so /api/billing/* matches first
app.route("/api/billing", billing);

// Mount me routes before api so /api/me/* matches first
app.route("/api/me", me);

// Mount API routes
app.route("/api", api);
app.route("/api", report);

// GET /upgrade — sign in if needed, then redirect to checkout
app.route("/", upgrade);

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
