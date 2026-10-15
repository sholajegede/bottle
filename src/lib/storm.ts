import { randomBytes } from "node:crypto";
import { billingHandlers } from "./billing";
import type { Db } from "./db";
import { accept, drain, type Handler } from "./intake";
import { balance } from "./quota";

/**
 * The storm: a test account receives a set of billing events the hard way.
 * Copies arrive more than once, a payment arrives before the plan change it belongs to,
 * an old cancellation arrives last, and the worker stops once in the middle of an event.
 * The same intake and the same handlers as production do the work.
 */

export interface StormStep {
  n: number;
  label: string;
  type: string;
  outcome: "accepted" | "duplicate";
  effect: string;
  plan: string;
  balance: number;
}

export interface StormResult {
  steps: StormStep[];
  final: { plan: string; balance: number; events: number; copies: number; duplicates: number; retried: number };
}

const SOURCE = "sandbox";

/** The production handlers, with one planned failure: an event marked fail_once stops on its first run. */
const handlers: Record<string, Handler> = Object.fromEntries(
  Object.entries(billingHandlers).map(([type, handler]) => [
    type,
    async (q, event) => {
      const text = await handler(q, event);
      const data = event.payload.data as { fail_once?: boolean } | undefined;
      if (data?.fail_once && event.attempts === 1) throw new Error("The worker stopped before it finished.");
      return text;
    },
  ]),
);

export async function runStorm(db: Db): Promise<StormResult> {
  await db.query(`DELETE FROM inbox_events WHERE source = $1 AND received_at < now() - interval '1 hour'`, [SOURCE]);
  await db.query(`DELETE FROM ledger WHERE account_id LIKE 'sbx_%' AND created_at < now() - interval '1 hour'`);
  await db.query(`DELETE FROM accounts WHERE id LIKE 'sbx_%' AND created_at < now() - interval '1 hour'`);

  const run = randomBytes(6).toString("hex");
  const account = `sbx_${run}`;
  await db.query(`INSERT INTO accounts (id, email) VALUES ($1, 'storm@example.test')`, [account]);

  const base = Date.now();
  const period = new Date(base).toISOString().slice(0, 7);
  const cancelled = { key: "cancel", type: "customer.agreement_cancelled", at: base - 180_000, data: {} };
  const upgraded = { key: "plan", type: "customer.plan_changed", at: base - 120_000, data: { plan_code: "pro", fail_once: true } };
  const paid = { key: "pay", type: "customer.payment_succeeded", at: base - 60_000, data: {} };

  const deliveries: Array<[string, typeof paid]> = [
    ["The payment arrives first, before the plan change it belongs to", paid],
    ["The plan change arrives. The worker stops in the middle of it", upgraded],
    ["Kinde sends the plan change again", upgraded],
    ["The payment arrives again", paid],
    ["And again", paid],
    ["And again", paid],
    ["A cancellation from before the upgrade arrives late", cancelled],
    ["The plan change arrives a third time", upgraded],
    ["The payment arrives a fifth time", paid],
  ];

  const steps: StormStep[] = [];
  const failedOnce = new Set<string>();
  const effectOf = (key: string, duplicate: boolean, row: { status: string; result: string | null }) => {
    if (row.status === "failed") {
      failedOnce.add(key);
      return `Failed: ${row.result} The event stays stored and runs again.`;
    }
    if (failedOnce.delete(key)) return `The stored event ran again: ${row.result}`;
    if (duplicate) return "Dropped. This event is already stored.";
    return row.result ?? row.status;
  };
  let clock = base;
  for (const [index, [label, event]] of deliveries.entries()) {
    clock += 10_000;
    const now = new Date(clock);
    const { eventId, duplicate } = await accept(db, {
      source: SOURCE,
      dedupeKey: `${run}:${event.key}`,
      type: event.type,
      occurredAt: new Date(event.at),
      receivedAt: now,
      payload: { type: event.type, data: { user_id: account, ...event.data } },
    });
    await drain(db, handlers, { now, source: SOURCE });
    const [row] = await db.query<{ status: string; result: string | null }>(`SELECT status, result FROM inbox_events WHERE id = $1`, [eventId]);
    const [state] = await db.query<{ plan: string }>(`SELECT plan FROM accounts WHERE id = $1`, [account]);
    steps.push({
      n: index + 1,
      label,
      type: event.type,
      outcome: duplicate ? "duplicate" : "accepted",
      effect: effectOf(event.key, duplicate, row),
      plan: state.plan,
      balance: await balance(db, account, period),
    });
  }

  const [counts] = await db.query<{ events: string; copies: string }>(
    `SELECT COUNT(*) AS events, COALESCE(SUM(seen_count), 0) AS copies FROM inbox_events WHERE source = $1 AND dedupe_key LIKE $2`,
    [SOURCE, `${run}:%`],
  );
  const last = steps[steps.length - 1];
  return {
    steps,
    final: {
      plan: last.plan,
      balance: last.balance,
      events: Number(counts.events),
      copies: Number(counts.copies),
      duplicates: Number(counts.copies) - Number(counts.events),
      retried: 1,
    },
  };
}

export interface Feed {
  totals: { events: number; copies: number; duplicates: number; applied: number; ignored: number; waiting: number; replays: number };
  recent: Array<{ id: string; type: string; status: string; seen: number; result: string | null; received_at: string }>;
}

/** Numbers and the latest real events for the Engine Room. No payloads and no account ids leave the server. */
export async function feed(db: Db): Promise<Feed> {
  const [t] = await db.query<Record<string, string | null>>(
    `SELECT COUNT(*) AS events,
            COALESCE(SUM(seen_count), 0) AS copies,
            COUNT(*) FILTER (WHERE status = 'applied') AS applied,
            COUNT(*) FILTER (WHERE status = 'ignored') AS ignored,
            COUNT(*) FILTER (WHERE status IN ('received', 'processing', 'failed')) AS waiting,
            COALESCE(SUM(replays), 0) AS replays
       FROM inbox_events WHERE source = 'kinde'`,
  );
  const recent = await db.query<{ id: string; type: string; status: string; seen_count: number; result: string | null; received_at: Date }>(
    `SELECT id, type, status, seen_count, result, received_at FROM inbox_events WHERE source = 'kinde' ORDER BY id DESC LIMIT 12`,
  );
  const events = Number(t.events ?? 0);
  const copies = Number(t.copies ?? 0);
  return {
    totals: {
      events,
      copies,
      duplicates: copies - events,
      applied: Number(t.applied ?? 0),
      ignored: Number(t.ignored ?? 0),
      waiting: Number(t.waiting ?? 0),
      replays: Number(t.replays ?? 0),
    },
    recent: recent.map((row) => ({
      id: String(row.id),
      type: row.type,
      status: row.status,
      seen: row.seen_count,
      result: row.result,
      received_at: new Date(row.received_at).toISOString(),
    })),
  };
}
