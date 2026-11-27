/**
 * Agent feedback (POST /api/feedback, the send_feedback MCP tool, `aired
 * feedback`), modelled on `stripe feedback`: a kind, an impact and a short
 * message, stored in D1 `agent_feedback` (migrations/0011). The answer is an
 * id the agent tells the user. It is not a support channel, and it never
 * takes page HTML: a message that looks like a page is refused.
 *
 * Rate limits are counted in D1 (rows per caller in the last hour, and all
 * rows in the last day) inside the insert itself, so they hold across
 * isolates and locations and a burst can't slip past them. The route also
 * puts the in-memory limiter in front (TIERS.feedback), so a flood stops
 * before it reaches D1.
 *
 * No runtime imports, so tests run the real SQL over node:sqlite.
 */

export const FEEDBACK_KINDS = ["bug", "friction", "idea"] as const;
export const FEEDBACK_IMPACTS = ["blocked", "worked_around", "minor"] as const;
export const FEEDBACK_SOURCES = ["mcp", "cli", "api"] as const;
export const FEEDBACK_ACTORS = ["agent", "person"] as const;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
const SHORT_MAX = 100;

/** Per caller (account, else IP): this many an hour. */
export const FEEDBACK_PER_HOUR = 10;
/** Everyone together: this many a day, so the table can't be flooded. */
export const FEEDBACK_PER_DAY = 2000;

export const NOT_SUPPORT =
  "Thanks. This goes to the aired team, who read every one. It isn't a support channel, so there's no reply.";

export type FeedbackInput = {
  kind: (typeof FEEDBACK_KINDS)[number];
  impact: (typeof FEEDBACK_IMPACTS)[number] | null;
  message: string;
  pageId: string | null;
  tool: string | null;
  source: (typeof FEEDBACK_SOURCES)[number];
  client: string | null;
  actor: (typeof FEEDBACK_ACTORS)[number];
};

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Page markup: a document or the tags only a page carries. */
const LOOKS_LIKE_HTML = /<\s*(!doctype|html|head|body|script|style|iframe)\b/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Control characters other than tab and line breaks: terminal escapes and the like. */
// eslint-disable-next-line no-control-regex
const MESSAGE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** A request body as feedback, or the reason it's refused. */
export function parseFeedback(body: unknown): { ok: true; input: FeedbackInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Request body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (!oneOf(FEEDBACK_KINDS, b.kind)) return { ok: false, error: `kind must be one of: ${FEEDBACK_KINDS.join(", ")}` };
  if (b.impact !== undefined && b.impact !== null && !oneOf(FEEDBACK_IMPACTS, b.impact)) {
    return { ok: false, error: `impact must be one of: ${FEEDBACK_IMPACTS.join(", ")}` };
  }
  if (typeof b.message !== "string") return { ok: false, error: "message is required" };
  const message = b.message.trim();
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    return { ok: false, error: `message must be ${MESSAGE_MIN} to ${MESSAGE_MAX} characters` };
  }
  if (MESSAGE_CONTROL.test(message)) return { ok: false, error: "message can't contain control characters" };
  if (LOOKS_LIKE_HTML.test(message)) {
    return { ok: false, error: "Don't send page HTML in feedback. Describe what happened, and pass page_id if it's about a page." };
  }
  let pageId: string | null = null;
  if (b.page_id !== undefined && b.page_id !== null) {
    if (typeof b.page_id !== "string" || !PAGE_ID.test(b.page_id)) return { ok: false, error: "page_id must be a page id, like the one publish returned" };
    pageId = b.page_id;
  }
  const short = (name: string, v: unknown): string | null | { error: string } => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || v.length > SHORT_MAX || CONTROL.test(v)) return { error: `${name} must be a short string (at most ${SHORT_MAX} characters)` };
    return v.trim();
  };
  const tool = short("tool", b.tool);
  if (tool !== null && typeof tool === "object") return { ok: false, error: tool.error };
  const client = short("client", b.client);
  if (client !== null && typeof client === "object") return { ok: false, error: client.error };
  if (b.source !== undefined && !oneOf(FEEDBACK_SOURCES, b.source)) return { ok: false, error: `source must be one of: ${FEEDBACK_SOURCES.join(", ")}` };
  if (b.actor !== undefined && !oneOf(FEEDBACK_ACTORS, b.actor)) return { ok: false, error: `actor must be one of: ${FEEDBACK_ACTORS.join(", ")}` };
  return {
    ok: true,
    input: {
      kind: b.kind,
      impact: (b.impact ?? null) as FeedbackInput["impact"],
      message,
      pageId,
      tool,
      source: (b.source ?? "api") as FeedbackInput["source"],
      client,
      actor: (b.actor ?? "agent") as FeedbackInput["actor"],
    },
  };
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** fb_ and 10 random characters. */
export function feedbackId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = "fb_";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

export type FeedbackLimit = { ok: true } | { ok: false; reason: "caller" | "global" };

/** Which limit a refused send hit (for the error message). */
export async function feedbackAllowed(db: D1Database, rateKey: string, now: number): Promise<FeedbackLimit> {
  const hour = await db
    .prepare("SELECT COUNT(*) AS n FROM agent_feedback WHERE rate_key = ? AND created_at > ?")
    .bind(rateKey, now - 3600_000)
    .first<{ n: number }>();
  if (Number(hour?.n ?? 0) >= FEEDBACK_PER_HOUR) return { ok: false, reason: "caller" };
  const day = await db
    .prepare("SELECT COUNT(*) AS n FROM agent_feedback WHERE created_at > ?")
    .bind(now - 86400_000)
    .first<{ n: number }>();
  if (Number(day?.n ?? 0) >= FEEDBACK_PER_DAY) return { ok: false, reason: "global" };
  return { ok: true };
}

/**
 * Store one piece of feedback, unless the caller has sent FEEDBACK_PER_HOUR
 * in the last hour or everyone FEEDBACK_PER_DAY in the last day. The check
 * and the insert are one statement, so parallel sends can't go past either.
 * False when a limit refused it.
 */
export async function insertFeedback(
  db: D1Database,
  id: string,
  input: FeedbackInput,
  who: { userId: number | null; rateKey: string },
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO agent_feedback (id, kind, impact, message, page_id, tool, source, client, actor, user_id, rate_key, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM agent_feedback WHERE rate_key = ? AND created_at > ?) < ?
         AND (SELECT COUNT(*) FROM agent_feedback WHERE created_at > ?) < ?`,
    )
    .bind(
      id, input.kind, input.impact, input.message, input.pageId, input.tool, input.source, input.client, input.actor, who.userId, who.rateKey, now,
      who.rateKey, now - 3600_000, FEEDBACK_PER_HOUR,
      now - 86400_000, FEEDBACK_PER_DAY,
    )
    .run();
  return result.meta.changes === 1;
}

export type FeedbackRow = {
  id: string;
  kind: string;
  impact: string | null;
  message: string;
  page_id: string | null;
  tool: string | null;
  source: string;
  client: string | null;
  actor: string;
  user_id: number | null;
  created_at: number;
};

/** Newest first, for the owner (routes/admin.ts). `before` is a created_at from the last page. */
export async function listFeedback(db: D1Database, opts: { limit: number; before?: number; kind?: string }): Promise<FeedbackRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.before !== undefined) {
    where.push("created_at < ?");
    args.push(opts.before);
  }
  if (opts.kind !== undefined) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  const { results } = await db
    .prepare(
      `SELECT id, kind, impact, message, page_id, tool, source, client, actor, user_id, created_at FROM agent_feedback
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(...args, opts.limit)
    .all<FeedbackRow>();
  return results;
}
