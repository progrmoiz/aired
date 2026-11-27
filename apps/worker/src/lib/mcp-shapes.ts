import { z } from "zod";

/**
 * Structured output for every aired MCP tool: the `outputSchema` each tool
 * declares and the `structuredContent` it returns next to its text. One
 * file for both servers, so they can't drift: the hosted one
 * (routes/mcp.ts, lib/mcp-account.ts) and the stdio one in the npm package
 * (apps/mcp/src/index.ts imports this file, and the CLI build bundles it).
 * Its only import is zod. Field names are snake_case, like the tools' inputs.
 *
 * The converters turn the HTTP API's JSON (camelCase) into these shapes.
 * They never pass a PIN or a stored hash through: the API doesn't send
 * them, and the shapes have no field for them.
 */

const nullableString = z.string().nullable();

/** A page as its owner sees it: get_page, set_options and list_pages. */
export const pageShape = {
  id: z.string(),
  url: z.string(),
  title: nullableString,
  size: z.number().describe("Bytes of HTML"),
  views: z.number(),
  view_limit: z.number().nullable().describe("The page is gone after this many views; null: no limit"),
  has_pin: z.boolean().describe("Whether a PIN protects the page (the PIN itself is never returned)"),
  permanent: z.boolean(),
  created_at: nullableString,
  expires_at: nullableString.describe("ISO time, or null when permanent"),
  project: nullableString,
};

export const outputShapes = {
  publish_html: {
    id: z.string(),
    url: z.string(),
    updated: z.boolean().describe("True when this call replaced an existing page's HTML"),
    update_token: nullableString.describe("Pass with id to update this page later; null for pages your account owns"),
    expires_at: nullableString,
    owner: nullableString.describe("Your account login when the page is yours; null for anonymous pages and token updates"),
    claim_url: nullableString.describe("A person can open this to keep an anonymous page in their account"),
    upgrade_url: nullableString.describe("A person can open this to upgrade; agents can't pay"),
  },
  list_pages: {
    pages: z.array(z.object(pageShape)),
    cursor: nullableString.describe("Pass to list_pages for the next page of results; null at the end"),
  },
  get_page: pageShape,
  set_options: {
    ...pageShape,
    changed: z.array(z.string()).describe("Settings this call changed: title, pin, expiry, reads"),
  },
  update_page: {
    id: z.string(),
    url: z.string(),
    expires_at: nullableString,
    upgrade_url: nullableString,
  },
  delete_page: {
    id: z.string(),
    deleted: z.boolean(),
  },
  get_account: {
    login: z.string(),
    plan: z.string().describe("free or pro"),
    max_bytes: z.number().nullable(),
    publish_limit: z.string(),
    renews_at: nullableString,
    cancel_at_period_end: z.boolean(),
    upgrade_url: nullableString.describe("A person can open this to upgrade; agents can't pay"),
  },
  send_feedback: {
    id: z.string().describe("Tell the user this id"),
    message: z.string(),
  },
} as const;

type Shape<S extends Record<string, z.ZodTypeAny>> = z.infer<z.ZodObject<S>>;
export type PageOut = Shape<typeof pageShape>;
export type PublishOut = Shape<typeof outputShapes.publish_html>;
export type ListOut = Shape<typeof outputShapes.list_pages>;
export type SetOptionsOut = Shape<typeof outputShapes.set_options>;
export type UpdateOut = Shape<typeof outputShapes.update_page>;
export type DeleteOut = Shape<typeof outputShapes.delete_page>;
export type AccountOut = Shape<typeof outputShapes.get_account>;
export type FeedbackOut = Shape<typeof outputShapes.send_feedback>;

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

/** A page from GET /api/pages/:id/details, PATCH /api/pages/:id or an /api/me/pages item. */
export function pageOut(body: unknown, origin: string): PageOut {
  const p = obj(body);
  const id = String(p.id ?? "");
  return {
    id,
    url: str(p.url) ?? `${origin}/p/${id}`,
    title: str(p.title),
    size: num(p.size) ?? 0,
    views: num(p.readCount) ?? 0,
    view_limit: num(p.reads),
    has_pin: p.hasPin === true,
    permanent: p.permanent === true || (p.expiresAt === null && p.permanent === undefined),
    created_at: str(p.createdAt),
    expires_at: str(p.expiresAt),
    project: str(p.project),
  };
}

export function setOptionsOut(body: unknown, origin: string): SetOptionsOut {
  const b = obj(body);
  return { ...pageOut(b, origin), changed: Array.isArray(b.changed) ? b.changed.filter((c): c is string => typeof c === "string") : [] };
}

/** GET /api/me/pages. */
export function listOut(body: unknown, origin: string): ListOut {
  const b = obj(body);
  const pages = Array.isArray(b.pages) ? b.pages : [];
  return { pages: pages.map((p) => pageOut(p, origin)), cursor: str(b.cursor) };
}

/** POST /api/publish (create or token update), or PUT /api/pages/:id. */
export function publishOut(body: unknown, opts: { updated: boolean; owner: string | null }): PublishOut {
  const b = obj(body);
  return {
    id: String(b.id ?? ""),
    url: String(b.url ?? ""),
    updated: opts.updated,
    update_token: str(b.update_token),
    expires_at: str(b.expiresAt),
    owner: opts.owner,
    claim_url: str(b.claim_url),
    upgrade_url: str(obj(b.upgrade).url),
  };
}

export function updateOut(body: unknown): UpdateOut {
  const b = obj(body);
  return { id: String(b.id ?? ""), url: String(b.url ?? ""), expires_at: str(b.expiresAt), upgrade_url: str(obj(b.upgrade).url) };
}

/** GET /api/me, with the limits the server words for it. */
export function accountOut(body: unknown, opts: { upgradeUrl: string | null; publishLimit: string }): AccountOut {
  const b = obj(body);
  const billing = b.billing === null || b.billing === undefined ? null : obj(b.billing);
  const plan = str(b.plan) ?? "free";
  return {
    login: String(b.login ?? ""),
    plan,
    max_bytes: num(obj(b.limits).maxBytes),
    publish_limit: opts.publishLimit,
    renews_at: billing === null ? null : str(billing.renewsAt),
    cancel_at_period_end: billing !== null && billing.cancelAtPeriodEnd === true,
    upgrade_url: plan === "pro" ? null : opts.upgradeUrl,
  };
}

/** POST /api/feedback. */
export function feedbackOut(body: unknown): FeedbackOut {
  const b = obj(body);
  return { id: String(b.id ?? ""), message: String(b.message ?? "") };
}

/** One line per page setting, for the text next to get_page and set_options. */
export function pageText(p: PageOut, lead: string): string {
  return [
    `${lead} ${p.url}`,
    `Title: ${p.title ?? "(untitled)"}`,
    `Views: ${p.views}${p.view_limit !== null ? ` of ${p.view_limit} allowed` : ""}`,
    `PIN: ${p.has_pin ? "on" : "off"}`,
    p.expires_at !== null ? `Expires: ${p.expires_at}` : "Expires: never (permanent)",
    `Size: ${p.size} bytes`,
    ...(p.project !== null ? [`Project: ${p.project}`] : []),
  ].join("\n");
}

/** Input for set_options, the same on both servers. */
export const setOptionsInput = {
  id: z.string().describe("Page id, from publish_html or list_pages"),
  update_token: z.string().optional().describe("The page's update token. Not needed for pages your account owns"),
  title: z.string().nullable().optional().describe(`New title (at most 200 characters), or null to clear it`),
  pin: z.string().nullable().optional().describe("New PIN (4 to 64 characters), or null to remove the PIN"),
  ttl_seconds: z.number().int().optional().describe("Expire this many seconds from now (60 to 31536000). Makes a permanent page expire"),
  permanent: z.boolean().optional().describe("true: never expires. false: expires 7 days from now"),
  view_limit: z.number().int().nullable().optional().describe("Gone after this many views (1 to 1000000), or null to remove the limit"),
};

/** set_options arguments as a PATCH /api/pages/:id body. */
export function patchBody(args: {
  title?: string | null;
  pin?: string | null;
  ttl_seconds?: number;
  permanent?: boolean;
  view_limit?: number | null;
  update_token?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.pin !== undefined) body.pin = args.pin;
  if (args.ttl_seconds !== undefined) body.ttl = args.ttl_seconds;
  if (args.permanent !== undefined) body.permanent = args.permanent;
  if (args.view_limit !== undefined) body.reads = args.view_limit;
  if (args.update_token !== undefined) body.update_token = args.update_token;
  return body;
}

/** Input for send_feedback, the same on both servers. */
export const feedbackInput = {
  kind: z.enum(["bug", "friction", "idea"]).describe("bug: something broke; friction: it worked but was harder than it should be; idea: something missing"),
  message: z.string().describe("What happened and what you expected, 10 to 2000 characters. Never page HTML, tokens or PINs"),
  impact: z.enum(["blocked", "worked_around", "minor"]).optional().describe("How much it got in the way"),
  page_id: z.string().optional().describe("The page it's about, if any"),
  tool: z.string().optional().describe("The tool or command you were using, e.g. publish_html"),
};

export const FEEDBACK_DESCRIPTION =
  "Tell the aired team about a bug, friction or a missing feature in aired itself (not in the page you're building). " +
  "Use it when a result surprised you, a limit blocked you or these docs were wrong. At most one per task, and don't let it hold up the task. " +
  "Never include page HTML, tokens or PINs. It returns an id: tell the user you sent feedback and give them the id. It isn't a support channel.";
