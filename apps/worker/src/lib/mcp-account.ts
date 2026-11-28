/**
 * Results for the remote MCP tools (routes/mcp.ts) that pass the call to the
 * HTTP API, so the API's own rules (ownership, plan limits, rate limits,
 * claims) apply unchanged. This file turns the API's JSON answers into what
 * an agent reads: text, plus structuredContent in the shape the tool's
 * outputSchema declares (lib/mcp-shapes.ts, shared with the stdio
 * server). Its only import is that file. `origin` arguments are
 * siteOrigin(env).
 */
import {
  accountOut,
  contentOut,
  feedbackOut,
  getPageOut,
  getPageText,
  listOut,
  pageOut,
  pageText,
  publishOut,
  setOptionsOut,
  updateOut,
} from './mcp-shapes.ts';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const withData = (r: ToolResult, data: object): ToolResult => ({ ...r, structuredContent: data as Record<string, unknown> });

export const signInRequiredText = (origin: string): string =>
  `Sign in required: add aired as a connector at ${origin}/mcp/account (you sign in with your aired account), ` +
  'or connect with an aired API key (Authorization: Bearer aired_sk_...) from API keys in the dashboard. ' +
  'Without either, only publish_html works, anonymously.';

function text(lines: string[], isError = false): ToolResult {
  return { content: [{ type: 'text', text: lines.join('\n') }], ...(isError ? { isError: true } : {}) };
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * An API error body's fields, `{ error: { code, message, ...extra } }`
 * (lib/errors.ts), flat: `message`, `code` and the extras. A flat body
 * (`{ error: "...", code }`) reads the same.
 */
export function apiErrorFields(body: unknown): Obj & { message: string | null; code: string | null } {
  const b = (body ?? {}) as Obj;
  if (typeof b.error === 'object' && b.error !== null) {
    const e = b.error as Obj;
    return { ...e, message: str(e.message), code: str(e.code) };
  }
  return { ...b, message: str(b.error), code: str(b.code) };
}

/** An API error's message, or "The aired API answered <status>." */
export function apiErrorMessage(status: number, body: unknown): string {
  return apiErrorFields(body).message ?? `The aired API answered ${status}.`;
}

/** An API error as a tool error. Plan limits say a person must open the upgrade link. */
export function apiErrorResult(status: number, body: unknown, origin: string): ToolResult {
  const b = apiErrorFields(body);
  const message = apiErrorMessage(status, body);
  if (b.code === 'plan_limit' && str(b.upgrade_url)) {
    return text(
      [
        `${message} (${String(b.limit ?? 'plan limit')}).`,
        `A person needs to open this link to upgrade: ${String(b.upgrade_url)}`,
        'Agents can\'t pay. Pass the link to the user.',
      ],
      true,
    );
  }
  if (status === 401) return text([message, signInRequiredText(origin)], true);
  if (status === 429) return text([message, 'Wait a while before publishing again.'], true);
  return text([message], true);
}

function expiryLine(expiresAt: unknown): string {
  const e = str(expiresAt);
  return e ? `Expires: ${e.split('T')[0]}` : 'Expires: never (permanent)';
}

/** For a deck: its slide count and where its owner sees the speaker notes. */
export function deckLines(body: unknown): string[] {
  const c = contentOut(body);
  if (c.kind === 'doc') return ['Rendered from Markdown.'];
  if (c.kind !== 'deck') return [];
  return [`Slides: ${c.slides ?? 0}. Link to one with #/N, e.g. ${String((body as Obj).url ?? '')}#/2`, ...(c.presenter_url ? [`Speaker view (notes, only you): ${c.presenter_url}`] : [])];
}

function upgradeLines(body: Obj): string[] {
  const u = body.upgrade as Obj | undefined;
  const url = u && str(u.url);
  return url ? ['', `A person can remove the aired badge with Pro: ${url}`] : [];
}

/** A publish or update answered by the API, for the signed-in publish_html tool. */
export function publishResult(body: unknown, login: string): ToolResult {
  const b = (body ?? {}) as Obj;
  return withData(text([
    `Published to ${String(b.url)}`,
    `Owner: @${login} (it shows in the aired dashboard; update or delete it by id with update_page and delete_page)`,
    expiryLine(b.expiresAt),
    ...deckLines(b),
    ...upgradeLines(b),
  ]), publishOut(body, { updated: false, owner: login }));
}

/** An anonymous publish_html create, answered by the API: the token to update it and the link to keep it. */
export function anonymousPublishResult(body: unknown, origin: string): ToolResult {
  const b = (body ?? {}) as Obj;
  const c = contentOut(b);
  const lines = [
    `Published to ${String(b.url)}`,
    `Update token: ${String(b.update_token)}`,
    expiryLine(b.expiresAt),
    '',
    'Pass update_token and id to update the same URL.',
    `To keep this page in an aired account, open: ${String(b.claim_url)}`,
  ];
  if (c.kind === 'deck') {
    lines.push(`Slides: ${c.slides ?? 0}. Speaker notes stay out of the public page; the owner sees them at ${origin}/p/${String(b.id)}/presenter once the page is in their account.`);
  }
  return withData(text(lines), publishOut(body, { updated: false, owner: null }));
}

/** An anonymous publish_html update by id and update token, answered by the API. */
export function anonymousUpdateResult(body: unknown): ToolResult {
  const b = (body ?? {}) as Obj;
  const c = contentOut(b);
  const lines = [`Updated ${String(b.url)}`, `Update token: ${String(b.update_token)}`, 'Pass update_token and id to update again.'];
  if (c.kind === 'deck') lines.push(`Slides: ${c.slides ?? 0}.`);
  return withData(text(lines), publishOut(body, { updated: true, owner: null }));
}

function updateText(body: unknown): ToolResult {
  const b = (body ?? {}) as Obj;
  return text([`Updated ${String(b.url)}`, expiryLine(b.expiresAt), ...deckLines(b), ...upgradeLines(b)]);
}

/** update_page. */
export function updateResult(body: unknown): ToolResult {
  return withData(updateText(body), updateOut(body));
}

/** publish_html that replaced a page (by id, or id and update token). `owner`: the login when it's the caller's page. */
export function publishUpdateResult(body: unknown, owner: string | null): ToolResult {
  return withData(updateText(body), publishOut(body, { updated: true, owner }));
}

export function deleteResult(id: string): ToolResult {
  return withData(text([`Deleted page ${id}.`]), { id, deleted: true });
}

/** get_page: GET /api/pages/:id/details, and /source when include_source was asked for. */
export function pageResult(body: unknown, origin: string, source?: unknown): ToolResult {
  const p = getPageOut(body, origin, source);
  return withData(text([getPageText(p)]), p);
}

/** set_options: PATCH /api/pages/:id. */
export function setOptionsResult(body: unknown, origin: string): ToolResult {
  const p = setOptionsOut(body, origin);
  const what = p.changed.length > 0 ? `Changed ${p.changed.join(', ')} of` : 'Settings of';
  return withData(text([pageText(p, what)]), p);
}

/** send_feedback: POST /api/feedback. */
export function feedbackResult(body: unknown): ToolResult {
  const f = feedbackOut(body);
  return withData(text([`Feedback sent: ${f.id}`, f.message]), f);
}

/** GET /api/me/pages for list_pages. */
export function listResult(body: unknown, origin: string): ToolResult {
  const b = (body ?? {}) as Obj;
  const pages = Array.isArray(b.pages) ? (b.pages as Obj[]) : [];
  const data = listOut(body, origin);
  if (pages.length === 0) return withData(text(['No pages yet.']), data);
  const lines = pages.map((p) => {
    const bits = [
      `${String(p.id)}  ${origin}/p/${String(p.id)}`,
      str(p.title) ? `"${String(p.title)}"` : 'untitled',
      `${typeof p.readCount === 'number' ? p.readCount : 0} views`,
      p.expiresAt ? `expires ${String(p.expiresAt).split('T')[0]}` : 'permanent',
    ];
    if (p.hasPin === true) bits.push('PIN');
    if (str(p.project)) bits.push(`project ${String(p.project)}`);
    return bits.join(' · ');
  });
  if (str(b.cursor)) lines.push('', `More pages: call list_pages with cursor "${String(b.cursor)}".`);
  return withData(text(lines), data);
}

/** GET /api/me for get_account. upgradeUrl is null when billing is off. */
export function accountResult(
  body: unknown,
  opts: { upgradeUrl: string | null; freePublishLimit: string; proPublishLimit: string },
): ToolResult {
  const b = (body ?? {}) as Obj;
  const limits = (b.limits ?? {}) as Obj;
  const billing = b.billing as Obj | null | undefined;
  const plan = str(b.plan) ?? 'free';
  const mb = typeof limits.maxBytes === 'number' ? `${Math.round((limits.maxBytes as number) / 1_000_000)} MB` : 'unknown';
  const lines = [
    `Account: @${String(b.login)}`,
    `Plan: ${plan === 'pro' ? 'Pro' : 'Free'}`,
    `Largest page: ${mb}`,
    `Publish limit: ${limits.publishTier === 'pro' ? opts.proPublishLimit : opts.freePublishLimit}`,
  ];
  if (billing && str(billing.renewsAt)) {
    lines.push(`${billing.cancelAtPeriodEnd === true ? 'Ends' : 'Renews'}: ${String(billing.renewsAt).split('T')[0]}`);
  }
  if (plan !== 'pro' && opts.upgradeUrl !== null) lines.push(`upgrade_url: ${opts.upgradeUrl} (a person needs to open it)`);
  const publishLimit = limits.publishTier === 'pro' ? opts.proPublishLimit : opts.freePublishLimit;
  return withData(text(lines), accountOut(body, { upgradeUrl: opts.upgradeUrl, publishLimit }));
}
