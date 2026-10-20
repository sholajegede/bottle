import type { Db, Queryable } from "./db";

/**
 * The intake: one durable boundary for events that come from outside.
 *
 *   accept()  writes the event, counts a second copy as a duplicate, and returns. The caller
 *             answers 200 only after this, so an event is never acknowledged before it is safe.
 *   drain()   claims stored events with a lease and applies each one in a transaction.
 *             The effect and the "applied" mark commit together or not at all.
 *   replay()  puts an event back in the queue. Handlers are idempotent, so a replay is safe.
 */

export interface IncomingEvent {
  source: string;
  dedupeKey: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
  /** When the copy arrived. Defaults to now. */
  receivedAt?: Date;
}

export interface StoredEvent {
  id: string;
  source: string;
  dedupe_key: string;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
  seen_count: number;
}

/** A handler returns what it did. Start the text with "ignored" when it chose to do nothing. */
export type Handler = (q: Queryable, event: StoredEvent) => Promise<string>;

export const MAX_ATTEMPTS = 6;
const LEASE_SECONDS = 30;
const BACKOFF_SECONDS = [5, 30, 120, 600, 3600];

export async function accept(db: Db, event: IncomingEvent): Promise<{ eventId: string; duplicate: boolean }> {
  const received = event.receivedAt ?? new Date();
  return db.tx(async (q) => {
    const [row] = await q.query<{ id: string; inserted: boolean }>(
      `INSERT INTO inbox_events (source, dedupe_key, type, payload, occurred_at, received_at, next_attempt_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)
       ON CONFLICT (source, dedupe_key) DO UPDATE SET seen_count = inbox_events.seen_count + 1
       RETURNING id, (xmax = 0) AS inserted`,
      [event.source, event.dedupeKey, event.type, JSON.stringify(event.payload ?? {}), event.occurredAt, received],
    );
    await q.query(`INSERT INTO inbox_receipts (event_id, outcome, received_at) VALUES ($1, $2, $3)`, [
      row.id,
      row.inserted ? "accepted" : "duplicate",
      received,
    ]);
    return { eventId: String(row.id), duplicate: !row.inserted };
  });
}

export interface DrainResult {
  applied: number;
  ignored: number;
  failed: number;
}

export async function drain(
  db: Db,
  handlers: Record<string, Handler>,
  options: { limit?: number; now?: Date; source?: string } = {},
): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const result: DrainResult = { applied: 0, ignored: 0, failed: 0 };

  // Claim a batch. SKIP LOCKED lets two workers run at once without taking the same event.
  // An event that was claimed but never finished is claimed again when its lease ends.
  const claimed = await db.query<StoredEvent & Record<string, unknown>>(
    `UPDATE inbox_events
        SET status = 'processing', attempts = attempts + 1, locked_until = $1::timestamptz + make_interval(secs => $2)
      WHERE id IN (
        SELECT id FROM inbox_events
         WHERE ($4::text IS NULL OR source = $4)
           AND ((status IN ('received', 'failed') AND next_attempt_at <= $1)
             OR (status = 'processing' AND locked_until < $1))
         ORDER BY occurred_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $3)
      RETURNING id, source, dedupe_key, type, payload, occurred_at, attempts, seen_count`,
    [now, LEASE_SECONDS, options.limit ?? 25, options.source ?? null],
  );
  claimed.sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at) || Number(a.id) - Number(b.id));

  for (const event of claimed) {
    const handler = handlers[event.type];
    try {
      const outcome = await db.tx(async (q) => {
        const text = handler ? await handler(q, event) : "ignored: no handler for this type";
        const status = text.startsWith("ignored") ? "ignored" : "applied";
        await q.query(
          `UPDATE inbox_events SET status = $2, applied_at = $3, result = $4, locked_until = NULL WHERE id = $1`,
          [event.id, status, now, text],
        );
        return status;
      });
      if (outcome === "applied") result.applied += 1;
      else result.ignored += 1;
    } catch (error) {
      result.failed += 1;
      const dead = event.attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_SECONDS[Math.min(event.attempts - 1, BACKOFF_SECONDS.length - 1)];
      await db.query(
        `UPDATE inbox_events
            SET status = $2, result = $3, locked_until = NULL,
                next_attempt_at = $4::timestamptz + make_interval(secs => $5)
          WHERE id = $1`,
        [event.id, dead ? "dead" : "failed", error instanceof Error ? error.message : String(error), now, wait],
      );
    }
  }
  return result;
}

export async function replay(db: Db, eventId: string, now = new Date(), accountId?: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE inbox_events
        SET status = 'received', next_attempt_at = $2, replays = replays + 1, attempts = 0
      WHERE id = $1 AND status IN ('applied', 'ignored', 'failed', 'dead')
        AND ($3::text IS NULL OR account_id = $3)
      RETURNING id`,
    [eventId, now, accountId ?? null],
  );
  return rows.length > 0;
}
