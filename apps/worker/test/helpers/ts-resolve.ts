import { register } from "node:module";

/**
 * Lets a test import Worker modules that name their siblings as ./x.js and
 * use @aired/core: both resolve to the .ts sources. Import this first.
 */
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const core = new URL("../../../../packages/core/src/index.ts", ${JSON.stringify(import.meta.url)}).href;
export async function resolve(spec, ctx, next) {
  if (spec === "@aired/core") return next(core, ctx);
  if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL && ctx.parentURL.endsWith(".ts")) {
    const ts = new URL(spec.slice(0, -3) + ".ts", ctx.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, ctx);
  }
  return next(spec, ctx);
}`),
);
