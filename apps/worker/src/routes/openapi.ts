import { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { openApiDocument } from "../lib/openapi.ts";
import { siteOrigin } from "../lib/origin.ts";

const openapi = new Hono<AppBindings>();

// GET /api/openapi.json — the public API as an OpenAPI 3.1 document (lib/openapi.ts).
openapi.get("/openapi.json", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(openApiDocument(siteOrigin(c.env)));
});

export { openapi };
