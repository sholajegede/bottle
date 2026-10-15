import type { Db } from "./db";
import type { Bottle } from "./bottles";
import { assertPublicHost } from "./net";

/**
 * Delivery. tick() claims the bottles that are due, sends each one, and records the result.
 *
 * A send carries the bottle's id as an idempotency key. If a send works but the process stops
 * before the result is stored, the next attempt carries the same key, so the receiver
 * (or the email provider) can drop the second copy.
 */

const LEASE_SECONDS = 60;
export const RETRY_SECONDS = [30, 120, 600, 3600, 4 * 3600];
export const MAX_SENDS = RETRY_SECONDS.length + 1;

export type Sender = (bottle: Bottle) => Promise<string>;

async function sendWebhook(bottle: Bottle): Promise<string> {
  await assertPublicHost(bottle.target);
  let isJson = false;
  try {
    JSON.parse(bottle.body);
    isJson = true;
  } catch {}
  const response = await fetch(bottle.target, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": isJson ? "application/json" : "text/plain; charset=utf-8",
      "user-agent": "Bottle/1 (+https://github.com/sholajegede/bottle)",
      "idempotency-key": bottle.id,
      "bottle-id": bottle.id,
      "bottle-attempt": String(bottle.attempts),
    },
    body: bottle.body,
  });
  if (!response.ok) throw new Error(`The address answered ${response.status}.`);
  return `The address answered ${response.status}.`;
}

async function sendEmail(bottle: Bottle): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("Email is not set up on this server.");
    console.log(`\n[bottle] email to ${bottle.target}\n  subject: ${bottle.subject ?? "A bottle for you"}\n  ${bottle.body}\n`);
    return "Printed in the server log. No email key is set.";
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "idempotency-key": `bottle/${bottle.id}`,
    },
    body: JSON.stringify({
      from: process.env.BOTTLE_FROM ?? "Bottle <bottle@localhost>",
      to: [bottle.target],
      subject: bottle.subject ?? "A bottle for you",
      text: `${bottle.body}\n\n--\nSent with Bottle on ${new Date(bottle.created_at).toUTCString()}.`,
    }),
  });
  if (!response.ok) throw new Error(`The email service answered ${response.status}.`);
  return "The email service accepted the message.";
}

export const send: Sender = (bottle) => (bottle.kind === "webhook" ? sendWebhook(bottle) : sendEmail(bottle));

/**
 * Record the result of one send. A success marks the bottle delivered. A failure schedules the
 * next try after a back-off, or marks the bottle failed after the last try.
 * Only the holder of the current attempt can settle it, so a late answer from an old attempt changes nothing.
 */
export async function settle(
  db: Db,
  bottle: Pick<Bottle, "id" | "attempts">,
  outcome: { ok: boolean; detail: string },
  now: Date,
): Promise<"delivered" | "retrying" | "failed" | "stale"> {
  const last = bottle.attempts >= MAX_SENDS;
  const wait = RETRY_SECONDS[Math.min(Math.max(bottle.attempts, 1) - 1, RETRY_SECONDS.length - 1)];
  return db.tx(async (q) => {
    const rows = outcome.ok
      ? await q.query(
          `UPDATE bottles SET status = 'delivered', delivered_at = $3, locked_until = NULL, last_error = NULL
            WHERE id = $1 AND attempts = $2 AND status = 'sending'
            RETURNING id`,
          [bottle.id, bottle.attempts, now],
        )
      : await q.query(
          `UPDATE bottles
              SET status = $3, last_error = $4, locked_until = NULL,
                  next_attempt_at = $5::timestamptz + make_interval(secs => $6)
            WHERE id = $1 AND attempts = $2 AND status = 'sending'
            RETURNING id`,
          [bottle.id, bottle.attempts, last ? "failed" : "scheduled", outcome.detail, now, wait],
        );
    if (rows.length === 0) return "stale";
    await q.query(`INSERT INTO bottle_attempts (bottle_id, at, ok, detail) VALUES ($1, $2, $3, $4)`, [bottle.id, now, outcome.ok, outcome.detail]);
    return outcome.ok ? "delivered" : last ? "failed" : "retrying";
  });
}

/** Claim due bottles with a lease. A bottle whose lease ran out is claimed again with the same id. */
async function claim(db: Db, now: Date, where: string, params: unknown[], lease: number, limit: number) {
  return db.query<Bottle & Record<string, unknown>>(
    `UPDATE bottles
        SET status = 'sending', attempts = attempts + 1, locked_until = $1::timestamptz + make_interval(secs => $2)
      WHERE id IN (
        SELECT id FROM bottles
         WHERE ((status = 'scheduled' AND next_attempt_at <= $1)
            OR (status = 'sending' AND locked_until < $1))
           AND ${where}
         ORDER BY next_attempt_at
         FOR UPDATE SKIP LOCKED
         LIMIT $3)
      RETURNING *`,
    [now, lease, limit, ...params],
  );
}

export async function tick(
  db: Db,
  options: { now?: Date; limit?: number; sender?: Sender } = {},
): Promise<{ delivered: number; retrying: number; failed: number }> {
  const now = options.now ?? new Date();
  const sender = options.sender ?? send;
  const result = { delivered: 0, retrying: 0, failed: 0 };
  // Terminal bottles wait for `bottle listen` to collect them.
  const due = await claim(db, now, `kind <> 'terminal'`, [], LEASE_SECONDS, options.limit ?? 20);

  await Promise.all(
    due.map(async (bottle) => {
      let outcome: { ok: boolean; detail: string };
      try {
        outcome = { ok: true, detail: await sender(bottle) };
      } catch (error) {
        outcome = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      const state = await settle(db, bottle, outcome, now);
      if (state !== "stale") result[state] += 1;
    }),
  );
  return result;
}

/** How long `bottle listen` has to answer before the bottle is given out again. */
export const LISTEN_LEASE_SECONDS = 30;

/** Give the due terminal bottles of one account to a listener. */
export function claimForListener(db: Db, accountId: string, now = new Date(), limit = 10) {
  return claim(db, now, `kind = 'terminal' AND account_id = $4`, [accountId], LISTEN_LEASE_SECONDS, limit);
}

/** The listener's answer for one attempt. */
export async function acknowledge(
  db: Db,
  accountId: string,
  id: string,
  attempt: number,
  outcome: { ok: boolean; detail: string },
  now = new Date(),
) {
  const [row] = await db.query<{ id: string }>(`SELECT id FROM bottles WHERE id = $1 AND account_id = $2 AND kind = 'terminal'`, [id, accountId]);
  if (!row) return "missing" as const;
  return settle(db, { id, attempts: attempt }, outcome, now);
}
