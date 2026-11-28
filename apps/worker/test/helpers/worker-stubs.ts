import "./worker-loader.ts";
import { register } from "node:module";

// routes/mcp.ts bundles the skill as text (wrangler [[rules]]): load .md the
// same way here. Its MCP library (agents) imports two Workers-only modules:
// stand-ins with the classes it names.
const workersStub =
  "data:text/javascript," +
  encodeURIComponent(
    "class Base { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class WorkerEntrypoint extends Base {} export class DurableObject extends Base {} export class WorkflowEntrypoint extends Base {} export class RpcTarget {} export const env = {};",
  );
const emailStub = "data:text/javascript," + encodeURIComponent("export class EmailMessage {}");
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if (spec === "cloudflare:workers") return { url: ${JSON.stringify(workersStub)}, shortCircuit: true };
  if (spec === "cloudflare:email") return { url: ${JSON.stringify(emailStub)}, shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith(".md")) return { format: "module", source: "export default " + JSON.stringify(readFileSync(fileURLToPath(url), "utf8")), shortCircuit: true };
  return next(url, ctx);
}`),
);
