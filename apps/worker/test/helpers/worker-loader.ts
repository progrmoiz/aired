import { register } from "node:module";

/**
 * Lets tests import Worker modules as they are: ./x.js siblings resolve to
 * their .ts sources, @aired/core to its sources, and the two imports node
 * can't load get stand-ins. `cloudflare:workers` (the OAuth library's
 * WorkerEntrypoint) and `@cloudflare/puppeteer`, whose launch() hands the
 * BROWSER binding's own launch(), so a test's fake browser decides what
 * happens. Import this before any Worker module, with a dynamic import after.
 */
const core = new URL("../../../../packages/core/src/index.ts", import.meta.url).href;
const workers = "data:text/javascript," + encodeURIComponent("export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }");
const puppeteer =
  "data:text/javascript," + encodeURIComponent("export default { launch: async (binding) => binding.launch() };");

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if (spec === "@aired/core") return next(${JSON.stringify(core)}, ctx);
  if (spec === "cloudflare:workers") return { url: ${JSON.stringify(workers)}, shortCircuit: true };
  if (spec === "@cloudflare/puppeteer") return { url: ${JSON.stringify(puppeteer)}, shortCircuit: true };
  if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL && ctx.parentURL.endsWith(".ts")) {
    const ts = new URL(spec.slice(0, -3) + ".ts", ctx.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, ctx);
  }
  return next(spec, ctx);
}`),
);
