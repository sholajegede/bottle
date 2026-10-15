import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { LISTEN_LEASE_SECONDS, MAX_SENDS, RETRY_SECONDS } from "./deliver";
import { verifyWebhook } from "./kinde";
import { assertPublicHost } from "./net";

/**
 * The relay: Kinde webhooks for your own app, delivered to your machine by `bottle listen`.
 *
 * It uses the same rules as Bottle's own intake:
 *   1. Check the signature against your Kinde domain. Refuse anything that fails.
 *   2. Keep one row for each webhook-id. A retry from Kinde adds one to seen_count and nothing else.
 *   3. Answer 200 once the row is stored, so Kinde stops retrying.
 *   4. Give each row to a listener with a lease. With no answer, the lease ends and the row is
 *      given out again with the same webhook-id, so your handler can drop the repeat.
 */

export interface RelayEvent {
  id: string;
  account_id: string;
  dedupe_key: string;
  type: string;
  token: string;
  payload: Record<string, unknown>;
  received_at: Date;
  seen_count: number;
  status: "waiting" | "sending" | "delivered" | "failed";
  attempts: number;
}

export class RelayError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const newRelayId = () => `rly_${randomBytes(18).toString("base64url")}`;
const newEventId = () => `rev_${randomBytes(12).toString("base64url")}`;

export async function relayInfo(db: Db, accountId: string) {
  await db.query(`UPDATE accounts SET relay_id = $2 WHERE id = $1 AND relay_id IS NULL`, [accountId, newRelayId()]);
  const [row] = await db.query<{ relay_id: string; relay_issuer: string | null; waiting: number; delivered: number; copies: number }>(
    `SELECT a.relay_id, a.relay_issuer,
            count(e.id) FILTER (WHERE e.status IN ('waiting', 'sending'))::int AS waiting,
            count(e.id) FILTER (WHERE e.status = 'delivered')::int AS delivered,
            COALESCE(sum(e.seen_count), 0)::int AS copies
       FROM accounts a LEFT JOIN relay_events e ON e.account_id = a.id
      WHERE a.id = $1
      GROUP BY a.relay_id, a.relay_issuer`,
    [accountId],
  );
  return row;
}

/** Store the Kinde domain whose signatures the relay accepts, for example https://myapp.kinde.com. */
export async function setRelayDomain(db: Db, accountId: string, raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new RelayError("Give your Kinde domain, for example https://myapp.kinde.com.", 400);
  }
  const local = process.env.NODE_ENV !== "production" || process.env.BOTTLE_ALLOW_LOCAL_TARGETS === "1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new RelayError("The Kinde domain must start with https://.", 400);
  }
  try {
    await assertPublicHost(url.origin);
  } catch {
    throw new RelayError("The Kinde domain must be on the public internet.", 400);
  }
  await relayInfo(db, accountId);
  await db.query(`UPDATE accounts SET relay_issuer = $2 WHERE id = $1`, [accountId, url.origin]);
  return url.origin;
}

/** One delivery from Kinde to the relay URL. Returns whether it was a repeat of a stored event. */
export async function receive(db: Db, relayId: string, token: string, webhookId: string | null, now = new Date()) {
  const [account] = await db.query<{ id: string; relay_issuer: string | null }>(
    `SELECT id, relay_issuer FROM accounts WHERE relay_id = $1`,
    [relayId],
  );
  if (!account) throw new RelayError("There is no relay at this address.", 404);
  if (!account.relay_issuer) throw new RelayError("Set your Kinde domain first: bottle relay --kinde-domain <domain>", 409);

  let event;
  try {
    event = await verifyWebhook(token, account.relay_issuer);
  } catch {
    throw new RelayError("The signature is not valid for this Kinde domain.", 401);
  }
  const dedupeKey = webhookId || event.eventId;
  if (!dedupeKey) throw new RelayError("The event has no id.", 400);

  const [row] = await db.query<{ id: string; seen_count: number }>(
    `INSERT INTO relay_events (id, account_id, dedupe_key, type, token, payload, received_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (account_id, dedupe_key) DO UPDATE SET seen_count = relay_events.seen_count + 1
     RETURNING id, seen_count`,
    [newEventId(), account.id, dedupeKey, event.type, token.trim(), JSON.stringify(event.payload), now],
  );
  return { id: row.id, duplicate: row.seen_count > 1, copies: row.seen_count };
}

/** Give the waiting relay events of one account to a listener, each with a lease. */
export function claimRelay(db: Db, accountId: string, now = new Date(), limit = 10) {
  return db.query<RelayEvent & Record<string, unknown>>(
    `UPDATE relay_events
        SET status = 'sending', attempts = attempts + 1, locked_until = $1::timestamptz + make_interval(secs => $2)
      WHERE id IN (
        SELECT id FROM relay_events
         WHERE account_id = $4
           AND ((status = 'waiting' AND next_attempt_at <= $1) OR (status = 'sending' AND locked_until < $1))
         ORDER BY received_at
         FOR UPDATE SKIP LOCKED
         LIMIT $3)
      RETURNING *`,
    [now, LISTEN_LEASE_SECONDS, limit, accountId],
  );
}

/** The listener's answer for one attempt. A late answer from an old attempt changes nothing. */
export async function ackRelay(
  db: Db,
  accountId: string,
  id: string,
  attempt: number,
  outcome: { ok: boolean; detail: string },
  now = new Date(),
): Promise<"delivered" | "retrying" | "failed" | "stale" | "missing"> {
  const [row] = await db.query<{ id: string }>(`SELECT id FROM relay_events WHERE id = $1 AND account_id = $2`, [id, accountId]);
  if (!row) return "missing";
  const last = attempt >= MAX_SENDS;
  const wait = RETRY_SECONDS[Math.min(Math.max(attempt, 1) - 1, RETRY_SECONDS.length - 1)];
  const rows = outcome.ok
    ? await db.query(
        `UPDATE relay_events SET status = 'delivered', delivered_at = $3, locked_until = NULL, last_error = NULL
          WHERE id = $1 AND attempts = $2 AND status = 'sending' RETURNING id`,
        [id, attempt, now],
      )
    : await db.query(
        `UPDATE relay_events
            SET status = $3, last_error = $4, locked_until = NULL, next_attempt_at = $5::timestamptz + make_interval(secs => $6)
          WHERE id = $1 AND attempts = $2 AND status = 'sending' RETURNING id`,
        [id, attempt, last ? "failed" : "waiting", outcome.detail, now, wait],
      );
  if (rows.length === 0) return "stale";
  return outcome.ok ? "delivered" : last ? "failed" : "retrying";
}
