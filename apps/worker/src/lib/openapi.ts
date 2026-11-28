/**
 * The public HTTP API as an OpenAPI 3.1 document, served at
 * GET /api/openapi.json (routes/openapi.ts) and linked from apps/web/docs.html.
 *
 * Written by hand, next to the routes it describes. test/openapi.test.ts
 * fails when a route under /api (routes/api-table.ts) has no entry here and
 * isn't in INTERNAL_ROUTES, or when an entry here has no route, so the two
 * can't drift apart. Response schemas name the fields clients read; the
 * prose in docs.html says more about each.
 *
 * Only plain data, no imports, so tests load it directly.
 */

type Schema = Record<string, unknown>;

/**
 * Routes under /api that aren't part of the public API, and why. Every
 * other /api route needs an operation below.
 */
export const INTERNAL_ROUTES: Record<string, string> = {
  "POST /api/admin/pages-backfill": "Operator only (ADMIN_TOKEN); off unless set.",
  "GET /api/admin/feedback": "Operator only (ADMIN_TOKEN); off unless set.",
  "GET /api/admin/site-events": "Operator only (ADMIN_TOKEN); off unless set.",
  "POST /api/billing/webhook": "Stripe's webhook, verified by its signature; not for clients.",
  "POST /api/site-event": "The website's own click counter for guide pages.",
  "POST /api/me/pages/shots": "The dashboard asking for missing tile screenshots.",
  "GET /api/me/pages/:id/tile": "The dashboard's tile image for a page.",
  "GET /api/me/pages/:id/preview": "The dashboard's preview of a page's HTML.",
  "GET /api/pages/:id/check.jpg": "A page check's screenshot; its signed URL comes in the check's answer.",
  "GET /api/favicon/:host": "Icons for an analytics report; their signed URLs come in the report.",
};

const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
const int = (description?: string): Schema => ({ type: "integer", ...(description ? { description } : {}) });
const bool = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as string, "null"] });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
  ...extra,
});
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const arr = (items: Schema): Schema => ({ type: "array", items });

type Auth = "none" | "apiKey" | "session" | "cliSession" | "updateToken";

type Op = {
  summary: string;
  description?: string;
  tags: string[];
  /** Who may call it. "none" first means it works anonymously. */
  auth: Auth[];
  query?: Array<{ name: string; schema: Schema; description: string }>;
  headers?: Array<{ name: string; schema: Schema; description: string }>;
  body?: Schema;
  ok: { status?: number; description: string; schema?: Schema; type?: string; headers?: Record<string, Schema> };
  errors: number[];
};

const ID = { name: "id", schema: str(), description: "The page id, from the publish answer or GET /api/me/pages." };

const SECURITY: Record<Exclude<Auth, "none">, Record<string, string[]>> = {
  apiKey: { apiKey: [] },
  session: { session: [] },
  cliSession: { cliSession: [] },
  updateToken: { updateToken: [] },
};

const ERROR_TEXT: Record<number, string> = {
  400: "Invalid input: invalid_json, invalid_input (with field), invalid_html, invalid_idempotency_key.",
  401: "No credential where one is needed (token_required), or an invalid or revoked API key (unauthorized).",
  402: "plan_limit: needs Pro. Carries limit and upgrade_url, for a person to open.",
  403: "invalid_token, not_owner, owner_required, or forbidden (a signed-in browser without X-Aired-Request: 1).",
  404: "not_found: no such page, or it expired or was deleted.",
  405: "method_not_allowed: the path exists with other methods (see Allow).",
  409: "A conflict, with a code: idempotency_in_progress, already_current, key_limit, already_pro.",
  410: "The page or version is gone (view limit reached, version_gone).",
  413: "payload_too_large: the body is over 21 MB (publish, PUT) or 1 MB (everything else).",
  422: "spam_rejected, or idempotency_key_reused (the same Idempotency-Key with a different body).",
  429: "rate_limited, check_budget or pdf_budget. See Retry-After when present.",
  502: "bad_gateway, check_failed or pdf_failed: something upstream failed. Retry.",
  503: "unavailable, storage_unavailable, check_busy, pdf_busy and the like: retry shortly.",
};

const PUBLISH_BODY = obj(
  {
    html: str("The page's HTML. Required unless markdown is sent. Up to 2 MB (10 MB on Pro)."),
    markdown: str("Markdown instead of html, rendered as a doc (or a deck with deck: true)."),
    deck: bool("Show as slides: Markdown split on --- lines, or HTML <section> slides."),
    title: str("Page title, else the Markdown's or the HTML's <title>. Cut to 200 characters."),
    ttl: int("Seconds until it expires (default 604800, 7 days), at most 31536000."),
    permanent: bool("Never expires. Signed-in publishes default to permanent unless ttl or permanent: false is sent."),
    pin: str("A PIN viewers must enter, at most 64 characters."),
    reads: int("Stop opening after this many views, at most 1000000."),
    project: str("Group it under a project in your account."),
    message: str("A label for this version in the page's history, up to 200 characters."),
    id: str("With update_token: replace this page instead of making a new one."),
    update_token: str("With id: the page's update token."),
  },
  [],
  { description: "A field of the wrong type is ignored; a value past its bound is a 400 invalid_input with field." },
);

const PUBLISH_ANSWER = obj(
  {
    id: str(),
    url: str("The page's public URL."),
    update_token: str("The page's credential (at_…). Keep it to update or delete the page."),
    expiresAt: nullable(str("ISO time, or null when permanent.")),
    version: int("The live version's number."),
    kind: { type: "string", enum: ["page", "doc", "deck"] },
    slides: int("A deck's slide count."),
    presenter_url: str("A deck's speaker view, for its owner."),
    claim_url: str("Anonymous publishes only: open it signed in to keep the page in an account."),
    upgrade: obj({ reason: str(), url: str() }),
  },
  ["id", "url", "expiresAt"],
);

const DETAILS = obj(
  {
    id: str(),
    url: str(),
    title: nullable(str()),
    size: int("Bytes of HTML."),
    readCount: int("Views so far."),
    reads: nullable(int("View limit.")),
    hasPin: bool(),
    access: str("public, pin or people."),
    permanent: bool(),
    createdAt: str(),
    expiresAt: nullable(str()),
    project: nullable(str()),
    kind: str(),
    allowed: obj({ emails: arr(str()), domains: arr(str()) }),
  },
  ["id", "url"],
);

const looseObject = (description: string): Schema => ({ type: "object", description, additionalProperties: true });

/** Every public /api operation, by "METHOD /api/path" with Hono's :params. */
const OPERATIONS: Record<string, Op> = {
  "POST /api/publish": {
    summary: "Publish a page",
    description:
      "Create a page from HTML or Markdown, or replace one when id and update_token are sent. Send an Idempotency-Key to retry safely: a repeat with the same key and body within 24 hours answers the first response (with Idempotent-Replayed: true) instead of making a second page; the same key with a different body is a 422. Keys are per account, or per network when anonymous.",
    tags: ["Pages"],
    auth: ["none", "apiKey", "cliSession", "session"],
    headers: [{ name: "Idempotency-Key", schema: { type: "string", maxLength: 255 }, description: "Any string up to 255 printable characters; a new one per publish." }],
    body: PUBLISH_BODY,
    ok: { description: "The page.", schema: PUBLISH_ANSWER, headers: { "Idempotent-Replayed": { type: "string", enum: ["true"] } } },
    errors: [400, 401, 402, 403, 404, 409, 413, 422, 429, 503],
  },
  "GET /api/pages/:id": {
    summary: "A page's public metadata",
    description: "No auth. A PIN-protected page answers title: null and readCount: 0.",
    tags: ["Pages"],
    auth: ["none"],
    ok: { description: "Public metadata.", schema: obj({ id: str(), title: nullable(str()), size: int(), readCount: int(), expiresAt: nullable(str()), pinProtected: bool() }) },
    errors: [404],
  },
  "PUT /api/pages/:id": {
    summary: "Replace a page's content",
    description: "By update_token (in the body, or Authorization: Bearer at_…), or as its signed-in owner. The content it replaces is kept as a version.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    body: obj({
      html: str("Required unless markdown is sent."),
      markdown: str(),
      deck: bool(),
      title: str(),
      message: str("A label for the new version."),
      update_token: str(),
    }),
    ok: { description: "The page.", schema: PUBLISH_ANSWER },
    errors: [400, 401, 402, 403, 404, 413, 422],
  },
  "PATCH /api/pages/:id": {
    summary: "Change a page's settings",
    description: "Title, PIN, expiry, view limit, PDF downloads and who can open it, without the HTML. Send only what changes; unknown fields are refused.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    body: obj({
      title: nullable(str()),
      pin: nullable(str()),
      ttl: int(),
      permanent: bool(),
      reads: nullable(int()),
      allow_pdf: bool(),
      access: obj({ mode: { type: "string", enum: ["public", "pin", "people"] }, emails: arr(str()), domains: arr(str()) }),
      update_token: str(),
    }),
    ok: { description: "The details, plus what changed.", schema: { ...DETAILS, properties: { ...(DETAILS.properties as object), changed: arr(str()) } } },
    errors: [400, 401, 402, 403, 404, 413, 422, 429, 503],
  },
  "DELETE /api/pages/:id": {
    summary: "Delete a page",
    description: "By Authorization: Bearer <update_token>, update_token in a JSON body, or as its signed-in owner.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    ok: { description: "Deleted.", schema: obj({ ok: { const: true } }, ["ok"]) },
    errors: [401, 403, 404, 429, 503],
  },
  "GET /api/pages/:id/details": {
    summary: "A page's details, for its owner",
    description: "Signed in as the owner, or the page's token in X-Update-Token (or Authorization: Bearer). Never the PIN.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    ok: { description: "The owner's view.", schema: DETAILS },
    errors: [401, 403, 404, 429, 503],
  },
  "GET /api/pages/:id/source": {
    summary: "A page's source, for its owner",
    description: "The HTML as served and what was published (the Markdown, or a deck's HTML with its notes). Never counts a view.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    ok: { description: "The owner's copy.", schema: obj({ id: str(), url: str(), title: nullable(str()), size: int(), html: str(), kind: str(), format: str(), source: str(), slides: int(), notes: arr(str()), version: int() }) },
    errors: [401, 403, 404, 503],
  },
  "POST /api/pages/:id/check": {
    summary: "Check a page in a browser",
    description: "Render it and report console errors, failed requests and a blank page, with a screenshot URL.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    body: obj({ update_token: str(), viewport: { type: "string", enum: ["desktop", "mobile"] }, inline_screenshot: bool() }),
    ok: { description: "The check's report.", schema: looseObject("ok, issues, console, failed_requests, blank, page, screenshot_url.") },
    errors: [401, 403, 404, 429, 503],
  },
  "POST /api/pages/:id/pdf": {
    summary: "Export a page as a PDF",
    description: "Speaker notes need the signed-in owner.",
    tags: ["Pages"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    body: obj({ update_token: str(), notes: bool(), paper: { type: "string", enum: ["a4", "letter"] } }),
    ok: { description: "Where to download it.", schema: obj({ download_url: str(), expires_at: str(), filename: str(), bytes: int(), pages: int(), kind: str(), paper: str(), notes: bool(), footer: bool(), cached: bool() }) },
    errors: [401, 403, 404, 413, 429, 503],
  },
  "GET /api/pages/:id/access": {
    summary: "Who can open a page, and who did",
    description: "Signed in as the owner only: the update token isn't enough.",
    tags: ["Pages"],
    auth: ["apiKey", "cliSession", "session"],
    ok: { description: "The list and the visitors.", schema: obj({ mode: str(), emails: arr(str()), domains: arr(str()), visitors: arr(obj({ email: str(), first_opened_at: str(), last_opened_at: str(), views: int() })) }) },
    errors: [401, 403, 404, 503],
  },
  "GET /api/pages/:id/versions": {
    summary: "A page's history",
    tags: ["History"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    ok: { description: "Versions, newest first.", schema: obj({ id: str(), url: str(), current: int(), versions: arr(looseObject("A version.")), kept: looseObject("What the plan keeps.") }) },
    errors: [401, 403, 404, 429],
  },
  "GET /api/pages/:id/versions/:n": {
    summary: "One version with its content",
    tags: ["History"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    ok: { description: "The version.", schema: looseObject("The version's fields plus html, format and source.") },
    errors: [401, 403, 404, 410, 429],
  },
  "POST /api/pages/:id/versions/:n/restore": {
    summary: "Restore a version",
    description: "Version n's content goes live as a new version. A page that has collected responses needs its owner signed in.",
    tags: ["History"],
    auth: ["updateToken", "apiKey", "cliSession", "session"],
    body: obj({ update_token: str(), message: str() }),
    ok: { description: "The new live version.", schema: obj({ id: str(), url: str(), version: int(), restored_from: int(), expiresAt: nullable(str()) }) },
    errors: [401, 403, 404, 409, 410, 429],
  },
  "GET /api/pages/:id/responses": {
    summary: "A page's collected entries",
    description: "Entries saved with aired.collect, newest first. Signed in as the owner only.",
    tags: ["Data"],
    auth: ["apiKey", "cliSession", "session"],
    query: [
      { name: "limit", schema: { type: "integer", maximum: 200 }, description: "Up to 200 (default 50)." },
      { name: "cursor", schema: str(), description: "From the previous answer." },
    ],
    ok: { description: "Entries.", schema: obj({ entries: arr(obj({ id: str(), viewer: nullable(str()), key: nullable(str()), data: {}, created_at: str(), updated_at: str() })), cursor: nullable(str()) }) },
    errors: [401, 402, 404, 429],
  },
  "GET /api/pages/:id/responses.csv": {
    summary: "A page's entries as CSV",
    tags: ["Data"],
    auth: ["apiKey", "cliSession", "session"],
    ok: { description: "One column per field.", type: "text/csv" },
    errors: [401, 402, 404, 429],
  },
  "PATCH /api/pages/:id/responses": {
    summary: "Change how a page collects",
    tags: ["Data"],
    auth: ["apiKey", "cliSession", "session"],
    body: obj({ public_results: bool("Let every viewer read all entries."), closed: bool("Stop taking new entries.") }),
    ok: { description: "The settings.", schema: obj({ id: str(), settings: looseObject("The page's data settings.") }) },
    errors: [400, 401, 402, 404],
  },
  "DELETE /api/pages/:id/responses": {
    summary: "Delete collected entries",
    tags: ["Data"],
    auth: ["apiKey", "cliSession", "session"],
    body: obj({ ids: arr(str()), all: bool() }),
    ok: { description: "How many went.", schema: obj({ deleted: int() }) },
    errors: [400, 401, 404],
  },
  "GET /api/pages/:id/data": {
    summary: "A page's live data",
    tags: ["Data"],
    auth: ["apiKey", "cliSession", "session"],
    ok: { description: "The data.", schema: obj({ version: int(), data: {}, updated_at: nullable(str()) }) },
    errors: [401, 402, 404, 429],
  },
  "PUT /api/pages/:id/data": {
    summary: "Push live data to a page",
    tags: ["Data"],
    auth: ["apiKey", "cliSession", "session"],
    body: obj({ data: { description: "Any JSON." } }, ["data"]),
    ok: { description: "The new data's version.", schema: obj({ version: int(), updated_at: str() }) },
    errors: [400, 401, 402, 404, 413, 429],
  },
  "GET /api/me": {
    summary: "Your account",
    tags: ["Account"],
    auth: ["apiKey", "cliSession", "session"],
    ok: { description: "Profile, plan and limits.", schema: looseObject("id, login, email, name, plan, limits, billing.") },
    errors: [401],
  },
  "DELETE /api/me": {
    summary: "Delete your account",
    description: "The website's session only: not with an API key, the CLI or a connected app.",
    tags: ["Account"],
    auth: ["session"],
    ok: { description: "Deleted.", schema: obj({ ok: { const: true } }) },
    errors: [401, 403, 409, 503],
  },
  "GET /api/me/pages": {
    summary: "Your pages",
    tags: ["Account"],
    auth: ["apiKey", "cliSession", "session"],
    query: [
      { name: "limit", schema: { type: "integer", maximum: 100 }, description: "Default 20." },
      { name: "cursor", schema: str(), description: "From the previous answer." },
      { name: "project", schema: str(), description: "Only this project's pages." },
    ],
    ok: { description: "A page of results.", schema: obj({ pages: arr(looseObject("id, title, readCount, expiresAt, hasPin, project, …")), cursor: str() }) },
    errors: [401, 503],
  },
  "GET /api/me/projects": {
    summary: "Your projects, with page counts",
    tags: ["Account"],
    auth: ["apiKey", "cliSession", "session"],
    ok: { description: "Projects.", schema: obj({ projects: arr(obj({ name: str(), count: int() })) }) },
    errors: [401, 503],
  },
  "POST /api/me/claim": {
    summary: "Keep an anonymous page in your account",
    description: "Replaces the page's update token; the answer has the new one.",
    tags: ["Account"],
    auth: ["apiKey", "cliSession", "session"],
    body: obj({ id: str(), update_token: str() }, ["id", "update_token"]),
    ok: { description: "Claimed.", schema: obj({ ok: bool(), page: looseObject("id, title, createdAt, expiresAt."), update_token: str() }) },
    errors: [400, 401, 403, 429, 503],
  },
  "POST /api/me/claim-batch": {
    summary: "Keep several anonymous pages",
    tags: ["Account"],
    auth: ["apiKey", "cliSession", "session"],
    body: obj({ items: { ...arr(obj({ id: str(), update_token: str() })), maxItems: 100 } }, ["items"]),
    ok: { description: "What was claimed.", schema: obj({ claimed: arr(str()), failed: arr(obj({ id: str(), reason: str() })), tokens: { type: "object", additionalProperties: str() } }) },
    errors: [400, 401, 429],
  },
  "POST /api/me/sign-out-everywhere": {
    summary: "End every session of your account",
    description: "Other browsers, CLI logins and connected apps. API keys keep working. The website's session only.",
    tags: ["Account"],
    auth: ["session"],
    ok: { description: "Done.", schema: obj({ ok: bool() }) },
    errors: [401, 403, 503],
  },
  "GET /api/me/keys": {
    summary: "Your API keys",
    description: "Never the keys themselves. The website's session only.",
    tags: ["Account"],
    auth: ["session"],
    ok: { description: "Keys, newest first.", schema: obj({ keys: arr(looseObject("id, name, prefix, createdAt, lastUsedAt.")) }) },
    errors: [401, 403],
  },
  "POST /api/me/keys": {
    summary: "Create an API key",
    description: "The key is in this answer only. Up to 5. The website's session only.",
    tags: ["Account"],
    auth: ["session"],
    body: obj({ name: str() }),
    ok: { description: "The new key.", schema: obj({ key: str("aired_sk_…, shown once."), id: str(), name: str() }) },
    errors: [400, 401, 403, 409],
  },
  "DELETE /api/me/keys/:id": {
    summary: "Revoke an API key",
    tags: ["Account"],
    auth: ["session"],
    ok: { description: "Revoked.", schema: obj({ ok: bool() }) },
    errors: [401, 403, 404],
  },
  "GET /api/me/analytics": {
    summary: "Views across your pages (Pro)",
    tags: ["Analytics"],
    auth: ["apiKey", "cliSession", "session"],
    query: [
      { name: "range", schema: { type: "integer", enum: [7, 30, 90] }, description: "Days (default 30)." },
      { name: "offset", schema: int(), description: "Whole windows back, within the last 90 days." },
    ],
    ok: { description: "The report.", schema: looseObject("Views per day, countries, referrers and pages.") },
    errors: [401, 402],
  },
  "GET /api/me/analytics/pages/:id": {
    summary: "Views of one of your pages (Pro)",
    tags: ["Analytics"],
    auth: ["apiKey", "cliSession", "session"],
    query: [
      { name: "range", schema: { type: "integer", enum: [7, 30, 90] }, description: "Days (default 30)." },
      { name: "offset", schema: int(), description: "Whole windows back." },
    ],
    ok: { description: "The report.", schema: looseObject("Views per day, countries and referrers.") },
    errors: [401, 402, 404],
  },
  "GET /api/billing/status": {
    summary: "Whether billing is on, and your plan",
    tags: ["Billing"],
    auth: ["none", "session"],
    ok: { description: "Billing state.", schema: looseObject("enabled, plan (null when signed out), renewal.") },
    errors: [],
  },
  "POST /api/billing/checkout": {
    summary: "Start a Pro checkout",
    description: "The website's session only.",
    tags: ["Billing"],
    auth: ["session"],
    body: obj({ interval: { type: "string", enum: ["month", "year"] } }),
    ok: { description: "Where to send the person.", schema: obj({ url: str() }, ["url"]) },
    errors: [400, 401, 403, 409, 429, 502, 503],
  },
  "POST /api/billing/portal": {
    summary: "Open the billing portal",
    description: "The website's session only.",
    tags: ["Billing"],
    auth: ["session"],
    ok: { description: "Where to send the person.", schema: obj({ url: str() }, ["url"]) },
    errors: [401, 403, 404, 429, 502, 503],
  },
  "POST /api/feedback": {
    summary: "Send feedback about aired",
    description: "Works without signing in; 10 an hour. Never page HTML.",
    tags: ["Other"],
    auth: ["none", "apiKey", "cliSession", "session"],
    body: obj({ kind: str(), message: str(), impact: str(), page_id: str(), tool: str() }, ["kind", "message"]),
    ok: { description: "The feedback's id.", schema: obj({ id: str(), message: str() }) },
    errors: [400, 413, 429, 503],
  },
  "POST /api/report": {
    summary: "Report a page for abuse",
    tags: ["Other"],
    auth: ["none"],
    body: obj({ id: str("A page id or URL."), category: { type: "string", enum: ["spam", "phishing", "malware", "illegal", "other"] }, reason: str(), contact: str() }, ["id", "reason"]),
    ok: { description: "Received.", schema: obj({ ok: bool() }) },
    errors: [400, 404, 429],
  },
  "GET /api/stats": {
    summary: "Aggregate counts",
    description: "Publishes, views and views per country. No page titles.",
    tags: ["Other"],
    auth: ["none"],
    ok: { description: "Counts.", schema: looseObject("publishes, views, countries.") },
    errors: [],
  },
  "GET /api/openapi.json": {
    summary: "This document",
    tags: ["Other"],
    auth: ["none"],
    ok: { description: "The OpenAPI 3.1 document.", schema: { type: "object" } },
    errors: [],
  },
};

/** "METHOD /api/path" for every operation here, with Hono's :params, for the route test. */
export function specRoutes(): string[] {
  return Object.keys(OPERATIONS);
}

const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z_]+)/g, "{$1}");
const PARAM_TEXT: Record<string, string> = {
  id: ID.description,
  n: "The version number, from the page's history.",
};

function operation(key: string, op: Op): Schema {
  const [method, path] = key.split(" ") as [string, string];
  const pathParams = [...path.matchAll(/:([A-Za-z_]+)/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: m[1] === "n" ? int() : str(),
    description: PARAM_TEXT[m[1]!] ?? m[1],
  }));
  const parameters = [
    ...pathParams,
    ...(op.query ?? []).map((q) => ({ name: q.name, in: "query", required: false, schema: q.schema, description: q.description })),
    ...(op.headers ?? []).map((h) => ({ name: h.name, in: "header", required: false, schema: h.schema, description: h.description })),
  ];
  const okStatus = String(op.ok.status ?? 200);
  const okType = op.ok.type ?? "application/json";
  const responses: Record<string, Schema> = {
    [okStatus]: {
      description: op.ok.description,
      ...(op.ok.headers ? { headers: Object.fromEntries(Object.entries(op.ok.headers).map(([n, s]) => [n, { schema: s }])) } : {}),
      content: { [okType]: { schema: op.ok.schema ?? { type: "string" } } },
    },
  };
  for (const status of op.errors) responses[String(status)] = { $ref: `#/components/responses/E${status}` };
  responses.default = { $ref: "#/components/responses/Error" };
  const security = op.auth.map((a) => (a === "none" ? {} : SECURITY[a]));
  return {
    operationId: `${method.toLowerCase()}${path.replace(/^\/api/, "").replace(/[/:.-]+(\w)/g, (_, ch: string) => ch.toUpperCase())}`,
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    tags: op.tags,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: op.body } } } } : {}),
    responses,
    security,
  };
}

const ERROR_SCHEMA: Schema = obj(
  {
    error: obj(
      {
        code: str("Stable and snake_case, for programs: not_found, invalid_input, rate_limited, plan_limit, …"),
        message: str("A sentence for people. May change."),
        field: str("invalid_input: the field that failed."),
        limit: str("plan_limit: which limit."),
        upgrade_url: str("plan_limit: a link for a person to open."),
      },
      ["code", "message"],
      { additionalProperties: true },
    ),
  },
  ["error"],
  {
    description:
      "Every /api error. aired CLI and stdio MCP builds up to 1.10.0 (User-Agent aired/1.10.0 or older) get the earlier flat shape, { error: <message>, code, ...extra }, which they read.",
    example: { error: { code: "not_found", message: "Page not found" } },
  },
);

export function openApiDocument(origin: string): Schema {
  const paths: Record<string, Record<string, Schema>> = {};
  for (const [key, op] of Object.entries(OPERATIONS)) {
    const [method, path] = key.split(" ") as [string, string];
    const p = toOpenApiPath(path);
    (paths[p] ??= {})[method.toLowerCase()] = operation(key, op);
  }
  const statuses = [...new Set(Object.values(OPERATIONS).flatMap((op) => op.errors))].sort();
  return {
    openapi: "3.1.0",
    info: {
      title: "aired API",
      version: "1",
      summary: "Publish HTML, Markdown and decks as shareable links.",
      description: `The HTTP API behind aired.sh, its CLI and its MCP servers. Publishing needs no account; an API key (Authorization: Bearer aired_sk_…) puts pages in yours. Docs: ${origin}/docs`,
    },
    servers: [{ url: origin }],
    externalDocs: { url: `${origin}/docs#api` },
    tags: ["Pages", "History", "Data", "Account", "Analytics", "Billing", "Other"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "An aired API key, aired_sk_…, from API keys in the dashboard. Requests run as your account." },
        updateToken: {
          type: "http",
          scheme: "bearer",
          description: "A page's update token, at_…, from its publish answer. Also accepted as update_token in the JSON body, or X-Update-Token when Authorization holds an API key.",
        },
        cliSession: { type: "apiKey", in: "header", name: "aired-Session", description: "The CLI's sign-in (aired login)." },
        session: {
          type: "apiKey",
          in: "cookie",
          name: "aired_session",
          description: "The website's sign-in. Writes must also send X-Aired-Request: 1.",
        },
      },
      schemas: { Error: ERROR_SCHEMA },
      responses: {
        Error: { description: "An error.", content: { "application/json": { schema: ref("Error") } } },
        ...Object.fromEntries(
          statuses.map((s) => [`E${s}`, { description: ERROR_TEXT[s] ?? "An error.", content: { "application/json": { schema: ref("Error") } } }]),
        ),
      },
    },
  };
}
