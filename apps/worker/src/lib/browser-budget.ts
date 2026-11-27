import { addSpent, readBudget, utcDay } from "./og-shot.ts";

/**
 * Browser time for work a caller asks for (check_page, PDF export), on top
 * of the link-preview screenshots' accounting in og-shot.ts. Its only
 * import is og-shot.ts, which has none, so tests load it directly.
 *
 * All browser time adds to the shared "browser" row of D1 og_shot_budget,
 * which stops at OG_SHOT_DAILY_SECONDS. Each kind of work is a lane with
 * its own row and daily cap ("check", "pdf"), so one kind can never use the
 * time the others need, and each caller has a share of the lane
 * (`<lane>:<caller>` rows, dropped the next day).
 *
 * A run is charged its longest possible time before the browser starts and
 * settled to the real time after, so runs at once, or a request cut off
 * mid-run, can't spend past the caps.
 */

/** Why the browser didn't run: a spent budget, a busy or blocking browser, no browser here, or the budget couldn't be read. */
export type BrowserUnavailableReason = "budget" | "busy" | "no_browser" | "storage";
export class BrowserUnavailable extends Error {
  readonly reason: BrowserUnavailableReason;
  readonly waitSeconds: number | null;
  constructor(reason: BrowserUnavailableReason, waitSeconds: number | null) {
    super(reason);
    this.reason = reason;
    this.waitSeconds = waitSeconds;
  }
}

type BudgetDb = Parameters<typeof readBudget>[0];
type RunDb = BudgetDb & { prepare(q: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } };

/** One kind of on-demand browser work. */
export type BudgetLane = {
  /** Its og_shot_budget row ("check", "pdf"); caller rows are `<row>:<caller key>`. */
  row: string;
  /** The whole browser budget (OG_SHOT_DAILY_SECONDS), ms. */
  totalMs: number;
  /** This lane's daily cap, never more than totalMs. 0 turns it off. */
  capMs: number;
  /** This caller's daily share of the lane. */
  callerCapMs: number;
};

export const laneCallerRow = (lane: Pick<BudgetLane, "row">, callerKey: string): string => `${lane.row}:${callerKey}`;

/** A daily cap in seconds from a var, as ms, never more than the whole browser budget. "0" turns it off; junk means the default. */
export function laneCapMs(raw: string | undefined, defaultMs: number, totalMs: number): number {
  let ms = defaultMs;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) ms = Math.floor(n * 1000);
  }
  return Math.max(0, Math.min(ms, totalMs));
}

const spentToday = (row: { day: string; spentMs: number } | null, nowMs: number) => (row !== null && row.day === utcDay(nowMs) ? row.spentMs : 0);

export function secondsToNextUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs) / 1000));
}

/**
 * Whether a run may start now. Any spent cap (the shared browser time, the
 * lane's, or this caller's share) is "budget" until 00:00 UTC; a block from
 * Browser Rendering ("too many" a moment ago) is "busy" with the seconds
 * left. A D1 error is "storage".
 */
export async function laneGate(db: BudgetDb, lane: BudgetLane, callerKey: string, nowMs: number): Promise<void> {
  let rows: Awaited<ReturnType<typeof readBudget>>[];
  try {
    rows = await Promise.all([readBudget(db), readBudget(db, lane.row), readBudget(db, laneCallerRow(lane, callerKey))]);
  } catch (err) {
    console.error("browser budget read failed", { lane: lane.row, err: String(err) });
    throw new BrowserUnavailable("storage", 30);
  }
  const [all, mine, caller] = rows;
  const callerCap = Math.min(lane.callerCapMs, lane.capMs);
  const spent =
    lane.capMs <= 0 ||
    spentToday(all ?? null, nowMs) >= lane.totalMs ||
    spentToday(mine ?? null, nowMs) >= lane.capMs ||
    spentToday(caller ?? null, nowMs) >= callerCap;
  if (spent) throw new BrowserUnavailable("budget", secondsToNextUtcDay(nowMs));
  const blockedUntil = Math.max(all?.blockedUntil ?? 0, mine?.blockedUntil ?? 0);
  if (nowMs < blockedUntil) throw new BrowserUnavailable("busy", Math.max(1, Math.ceil((blockedUntil - nowMs) / 1000)));
}

/** Charge `ms` to the shared row, the lane's row and the caller's row before launching. */
export async function reserveLaneTime(db: BudgetDb, lane: Pick<BudgetLane, "row">, callerKey: string, ms: number, nowMs: number): Promise<number> {
  await Promise.all([addSpent(db, ms, nowMs), addSpent(db, ms, nowMs, lane.row), addSpent(db, ms, nowMs, laneCallerRow(lane, callerKey))]);
  return ms;
}

/** After the run: swap the reservation for the time really spent, and drop this lane's caller rows from earlier days. */
export async function settleLaneTime(db: RunDb, lane: Pick<BudgetLane, "row">, callerKey: string, reservedMs: number, spentMs: number, nowMs: number): Promise<void> {
  const delta = spentMs - reservedMs;
  await Promise.all([addSpent(db, delta, nowMs), addSpent(db, delta, nowMs, lane.row), addSpent(db, delta, nowMs, laneCallerRow(lane, callerKey))]);
  await db.prepare("DELETE FROM og_shot_budget WHERE name LIKE ? AND day < ?").bind(`${lane.row}:%`, utcDay(nowMs)).run();
}
