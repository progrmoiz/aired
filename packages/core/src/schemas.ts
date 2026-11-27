import { z } from "zod";

/**
 * The publish and update request bodies (POST /api/publish, PUT
 * /api/pages/:id) as zod schemas, shared by the Worker and anything else
 * that builds these bodies. PATCH /api/pages/:id has the same bounds,
 * checked in the Worker's lib/page-options.ts.
 *
 * These bodies were checked by hand before, and a field of the wrong type
 * was ignored rather than refused (`pin: 1234` published with no PIN). That
 * stays, so no client that worked stops working; what's new is the bounds,
 * which refuse what used to crash the request or cost too much: a TTL past
 * a year (`ttl: 1e20` used to answer 500), a PIN over 64 characters (each
 * one is hashed with PBKDF2), a view limit past a million. Titles longer
 * than 200 characters are cut, not refused.
 */
export const PAGE_INPUT_LIMITS = {
  /** Longest title, in characters. Longer ones are cut on publish, refused by PATCH. */
  titleMax: 200,
  /** Longest PIN, in characters. */
  pinMax: 64,
  /** Longest TTL: a year, in seconds. Longer: use permanent. */
  ttlMaxSeconds: 365 * 24 * 60 * 60,
  /** Highest view limit. */
  readsMax: 1_000_000,
  /** Longest version note (`message`), in characters. */
  messageMax: 200,
} as const;

const L = PAGE_INPUT_LIMITS;
const HTML_REQUIRED = "html is required and must be a string";

/** A value of the wrong type counts as not sent (see the top). */
function ifType<T extends z.ZodTypeAny>(type: "string" | "number" | "boolean", schema: T) {
  return z.preprocess((v) => (typeof v === type ? v : undefined), schema.optional());
}

/** A title trimmed and cut to PAGE_INPUT_LIMITS.titleMax; null when blank. */
export function capTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  const t = title.trim();
  if (t === "") return null;
  const chars = Array.from(t);
  return chars.length > L.titleMax ? chars.slice(0, L.titleMax).join("").trim() : t;
}

const html = z.string({ required_error: HTML_REQUIRED, invalid_type_error: HTML_REQUIRED });
/** Markdown to render instead of HTML (a doc, or a deck); sent in place of html. */
const markdown = ifType("string", z.string());
/** Show the content as slides: Markdown split on `---`, or HTML's top-level <section>s. */
const deck = ifType("boolean", z.boolean());

/** html is required unless markdown is sent instead. */
const htmlOrMarkdown = (b: { html?: unknown; markdown?: unknown }, ctx: z.RefinementCtx) => {
  if (b.html === undefined && typeof b.markdown !== "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["html"], message: HTML_REQUIRED });
  }
};
const title = ifType("string", z.string());
const pin = ifType("string", z.string().max(L.pinMax, `pin can be at most ${L.pinMax} characters`));
const ttl = ifType(
  "number",
  z.number().max(L.ttlMaxSeconds, `ttl can be at most ${L.ttlMaxSeconds} seconds (a year); use permanent for longer`),
);
const reads = ifType("number", z.number().max(L.readsMax, `reads can be at most ${L.readsMax}`));
/** A short note kept with the version this update makes (page history). */
const message = ifType("string", z.string().max(L.messageMax, `message can be at most ${L.messageMax} characters`));

/** POST /api/publish: a new page, or an update with id + update_token. html, or markdown instead. */
export const publishBody = z
  .object({
    html: html.optional(),
    markdown,
    deck,
    title,
    pin,
    ttl,
    reads,
    permanent: ifType("boolean", z.boolean()),
    project: z.unknown().optional(),
    update_token: ifType("string", z.string()),
    id: ifType("string", z.string()),
    message,
  })
  .passthrough()
  .superRefine(htmlOrMarkdown);

/** PUT /api/pages/:id: new HTML (or markdown), by update token (or the Bearer header) or the signed-in owner. */
export const updateBody = z
  .object({
    html: html.optional(),
    markdown,
    deck,
    title,
    update_token: ifType("string", z.string()),
    message,
  })
  .passthrough()
  .superRefine(htmlOrMarkdown);

export type PublishBody = z.infer<typeof publishBody>;
export type UpdateBody = z.infer<typeof updateBody>;

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; error: string; field: string | null };

/**
 * A request body checked against a schema: the data, or the first problem
 * as a sentence and the field it's about. A body that isn't a JSON object is
 * refused before the schema runs.
 */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): ParsedBody<z.infer<S>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object", field: null };
  }
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const field = issue?.path[0];
  return { ok: false, error: issue?.message ?? "Invalid request body", field: typeof field === "string" ? field : null };
}
