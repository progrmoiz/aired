import { Hono, type Context } from "hono";
import type { AppBindings } from "../types.js";
import { apiError } from "../lib/errors.ts";
import { getEntitlements, planLimitError } from "../lib/entitlements.ts";
import { siteOrigin } from "../lib/origin.ts";
import { getPageRow } from "../lib/pages-store.ts";
import { readSidecar } from "../lib/page-content.ts";
import { MAX_DAYS, analyticsConfig, parseOffset, parseRange, windowDays, type Window } from "../lib/analytics.ts";
import { demoSlides, loadSlides, type DeckShape, type SlideNumbers, type SlideReport } from "../lib/slide-analytics.ts";

/**
 * GET /api/pages/:id/slides?days=7|30|90&offset=N — per-slide analytics for
 * one of the caller's decks (lib/slide-analytics.ts): for each slide, how
 * many people reached it, the median time on it, and how many stopped there.
 *
 * Signed in (session, API key or MCP OAuth), then in this order: 401 signed
 * out; 404 not their page, deleted or missing; 422 not_a_deck for a page
 * that isn't a deck; 402 plan_limit on Free; 503 analytics_unavailable
 * without the SQL API token. The page is looked at before the plan, so a
 * Free account sees the locked state only on its decks, and someone else's
 * page is a 404 either way. Answers are cached five minutes per deck and
 * window.
 *
 * Only .ts imports (and types), so tests run it with app.request().
 */
const slides = new Hono<AppBindings>();

const CACHE_SECONDS = 300;
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = Context<AppBindings>;

slides.get("/pages/:id/slides", async (c) => {
  const user = c.get("user");
  if (user === null || user === undefined) return apiError(c, 401, "unauthorized", "Sign in to see how far people get through your deck.");
  const id = c.req.param("id");
  if (!PAGE_ID.test(id)) return apiError(c, 404, "not_found", "Page not found");

  const range = parseRange(c.req.query("days"));
  if (range === null) return apiError(c, 400, "invalid_input", "days must be 7, 30 or 90", { field: "days" });
  const offset = parseOffset(c.req.query("offset"), range);
  if (offset === null) return apiError(c, 400, "invalid_input", `offset must be a whole number, within the last ${MAX_DAYS} days`, { field: "offset" });
  const w: Window = { range, offset };

  let deck: DeckShape | null;
  let title: string | null;
  try {
    const row = await getPageRow(c.env.DB, id);
    // Expired decks keep their numbers; deleted ones and other people's are 404.
    if (row === null || row.deletedAt !== null || row.ownerId !== user.id) return apiError(c, 404, "not_found", "Page not found");
    title = row.title;
    const sidecar = await readSidecar(c.env.PAGES_BUCKET, id);
    deck = sidecar?.kind === "deck" ? { slides: sidecar.slides, titles: sidecar.titles } : null;
  } catch (err) {
    console.error({ event: "slides_page_lookup_failed", id, error: err instanceof Error ? err.message : String(err) });
    return apiError(c, 503, "unavailable", "Could not load this page. Please try again.");
  }
  if (deck === null) return apiError(c, 422, "not_a_deck", "This page isn't a slide deck, so it has no per-slide numbers.");

  const ent = await getEntitlements(c.env, user.id);
  if (ent.plan !== "pro") {
    const { code, limit, upgrade_url } = planLimitError("slide_analytics", siteOrigin(c.env), "slides");
    return apiError(c, 402, code, "Per-slide numbers are part of Pro: see how many people reach each slide and where they stop.", { limit, upgrade_url });
  }

  c.header("Cache-Control", "private, no-store");
  const numbers = await numbersFor(c, id, w, deck);
  if (numbers instanceof Response) return numbers;
  const days = windowDays(w, Date.now());
  const report: SlideReport = {
    id, title, days: w.range, offset: w.offset, from: days[0]!, to: days[days.length - 1]!, slide_count: deck.slides, ...numbers,
  };
  return c.json(report);
});

/** The numbers from the cache, demo data, or Analytics Engine; or an error response. */
async function numbersFor(c: Ctx, id: string, w: Window, deck: DeckShape): Promise<SlideNumbers | Response> {
  if (c.env.ANALYTICS_DEMO === "1") return demoSlides(id, w, deck);
  const config = analyticsConfig(c.env);
  if (config === null) return apiError(c, 503, "analytics_unavailable", "Analytics is not set up yet.");

  // The deck's slide count is in the key: an update that adds or drops slides gets fresh numbers.
  const cacheKey = new Request(`https://analytics.aired.internal/slides/${id}?range=${w.range}&offset=${w.offset}&n=${deck.slides}`);
  const cache = typeof caches === "undefined" ? null : caches.default;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) {
    const cached = (await hit.json()) as SlideNumbers;
    return { ...cached, slides: cached.slides.map((s, i) => ({ ...s, title: deck.titles[i] ?? null })) };
  }

  let numbers: SlideNumbers;
  try {
    numbers = await loadSlides((url, init) => fetch(url, init), config, id, w, Date.now(), deck);
  } catch (err) {
    console.error({ event: "slides_query_failed", id, error: err instanceof Error ? err.message : String(err) });
    return apiError(c, 503, "unavailable", "Could not load the numbers. Please try again.");
  }
  if (cache !== null) {
    const stored = new Response(JSON.stringify(numbers), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_SECONDS}` },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
  }
  return numbers;
}

export { slides };
