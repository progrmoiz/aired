import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "./types.js";
import { api } from "./routes/api.js";
import { viewer } from "./routes/viewer.js";
import { report } from "./routes/report.js";

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

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Mount API routes
app.route("/api", api);
app.route("/api", report);

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
