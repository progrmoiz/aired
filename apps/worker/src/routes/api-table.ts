import type { Hono } from "hono";
import type { AppBindings } from "../types.js";
import { admin } from "./admin.ts";
import { billing } from "./billing.js";
import { keys } from "./keys.js";
import { analytics } from "./analytics.ts";
import { favicon } from "./favicon.ts";
import { me } from "./me.js";
import { pageTools } from "./page-tools.ts";
import { responses } from "./responses.ts";
import { versions } from "./versions.ts";
import { slides } from "./slides.ts";
import { openapi } from "./openapi.ts";
import { api } from "./api.js";
import { report } from "./report.js";
import { siteEvent } from "./site-event.js";
import { pdf } from "./pdf.ts";
import { access } from "./access.ts";

type Router = Hono<AppBindings>;

/**
 * Every router that answers /api paths, in the order index.ts mounts them:
 * the longer prefixes first, so /api/me/keys matches before /api/me and
 * /api/billing before /api. The OpenAPI test (test/openapi.test.ts) reads
 * the routes from here, so a route added to any of these needs its spec
 * entry (lib/openapi.ts).
 */
const API_MOUNTS: ReadonlyArray<readonly [string, Router]> = [
  // Operator endpoints, off unless ADMIN_TOKEN is set (routes/admin.ts).
  ["/api/admin", admin],
  ["/api/billing", billing],
  ["/api/me/keys", keys],
  ["/api/me/analytics", analytics],
  ["/api/favicon", favicon],
  ["/api/me", me],
  ["/api", pageTools],
  ["/api", slides],
  ["/api", responses],
  ["/api", versions],
  ["/api", openapi],
  ["/api", api],
  ["/api", report],
  ["/api", siteEvent],
];

/**
 * Routers mounted at the root that answer some /api paths besides their
 * site paths: PDF export (POST /api/pages/:id/pdf) and "only these people"
 * (GET /api/pages/:id/access). index.ts mounts them after the dashboard and
 * presenter routes, where they've always been.
 */
const MIXED_MOUNTS: ReadonlyArray<readonly [string, Router]> = [
  ["/", pdf],
  ["/", access],
];

export function mountApi(app: Router): void {
  for (const [prefix, router] of API_MOUNTS) app.route(prefix, router);
}

export function mountMixed(app: Router): void {
  for (const [prefix, router] of MIXED_MOUNTS) app.route(prefix, router);
}

export type ApiRoute = { method: string; path: string };

const join = (prefix: string, path: string): string => {
  const p = prefix.replace(/\/$/, "");
  return path === "/" ? p || "/" : p + path;
};

let cached: ApiRoute[] | null = null;

/**
 * Every /api route as METHOD and Hono path (/api/pages/:id), from the
 * routers themselves. Middleware entries (`use`, method ALL) aren't routes.
 */
export function apiRoutes(): ApiRoute[] {
  if (cached !== null) return cached;
  const seen = new Set<string>();
  const out: ApiRoute[] = [];
  for (const [prefix, router] of [...API_MOUNTS, ...MIXED_MOUNTS]) {
    for (const r of router.routes) {
      if (r.method === "ALL") continue;
      const path = join(prefix, r.path);
      if (path !== "/api" && !path.startsWith("/api/")) continue;
      const key = `${r.method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ method: r.method, path });
    }
  }
  cached = out;
  return out;
}

const patternCache = new Map<string, RegExp>();
function pattern(path: string): RegExp {
  let re = patternCache.get(path);
  if (re === undefined) {
    const body = path
      .split("/")
      .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg === "*" ? ".*" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/");
    re = new RegExp(`^${body}/?$`);
    patternCache.set(path, re);
  }
  return re;
}

/** The methods some /api route takes at this path (GET also answers HEAD), or none. */
export function allowedMethods(path: string): string[] {
  const methods = new Set<string>();
  for (const r of apiRoutes()) if (pattern(r.path).test(path)) methods.add(r.method);
  return [...methods];
}
