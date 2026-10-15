import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { checkWebhookUrl } from "./net";
import { balance, entry, grantFree, periodOf } from "./quota";

export type BottleKind = "email" | "webhook" | "terminal";

/** A terminal bottle has no address. `bottle listen` collects it from the server. */
export const TERMINAL = "terminal";
export type BottleStatus = "scheduled" | "sending" | "delivered" | "failed" | "cancelled";

export interface Bottle {
  id: string;
  account_id: string;
  kind: BottleKind;
  target: string;
  subject: string | null;
  body: string;
  deliver_at: Date;
  status: BottleStatus;
  attempts: number;
  delivered_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

export interface NewBottle {
  kind: BottleKind;
  target: string;
  subject?: string;
  body: string;
  deliverAt: Date;
  idempotencyKey?: string;
}

export class BottleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const MAX_BODY = 20_000;
const MAX_AHEAD_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const newId = () => `btl_${randomBytes(12).toString("base64url")}`;

export function validate(input: NewBottle, now: Date): void {
  if (input.kind !== "email" && input.kind !== "webhook" && input.kind !== "terminal") {
    throw new BottleError("Choose email, webhook or terminal.");
  }
  if (!input.body?.trim()) throw new BottleError("Write a message first.");
  if (input.body.length > MAX_BODY) throw new BottleError("The message is too long. The limit is 20,000 characters.");
  if (input.subject && input.subject.length > 200) throw new BottleError("The subject is too long.");
  if (Number.isNaN(+input.deliverAt)) throw new BottleError("The delivery time is not a valid date.");
  if (+input.deliverAt < +now - 60_000) throw new BottleError("The delivery time is in the past.");
  if (+input.deliverAt > +now + MAX_AHEAD_MS) throw new BottleError("The delivery time must be in the next five years.");
  if (input.kind === "email" && !EMAIL.test(input.target)) throw new BottleError("Enter a valid email address.");
  if (input.kind === "webhook") {
    const reason = checkWebhookUrl(input.target);
    if (reason) throw new BottleError(reason);
  }
  if (input.idempotencyKey && input.idempotencyKey.length > 200) throw new BottleError("The idempotency key is too long.");
}

/**
 * Store a bottle and spend one unit of quota, in one transaction.
 * The account row is locked first, so two requests cannot both spend the last unit.
 * A repeat of the same idempotency key returns the first bottle and spends nothing.
 */
export async function createBottle(
  db: Db,
  accountId: string,
  input: NewBottle,
  now = new Date(),
): Promise<{ bottle: Bottle; created: boolean }> {
  validate(input, now);
  const deliverAt = +input.deliverAt < +now ? now : input.deliverAt;
  return db.tx(async (q) => {
    await q.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [accountId]);

    if (input.idempotencyKey) {
      const [existing] = await q.query<Bottle & Record<string, unknown>>(
        `SELECT * FROM bottles WHERE account_id = $1 AND idempotency_key = $2`,
        [accountId, input.idempotencyKey],
      );
      if (existing) return { bottle: existing, created: false };
    }

    const period = periodOf(now);
    await grantFree(q, accountId, period);
    if ((await balance(q, accountId, period)) < 1) {
      throw new BottleError("You have used all your bottles for this month.", 402);
    }

    const id = newId();
    const [bottle] = await q.query<Bottle & Record<string, unknown>>(
      `INSERT INTO bottles (id, account_id, kind, target, subject, body, deliver_at, next_attempt_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
       RETURNING *`,
      [id, accountId, input.kind, input.kind === "terminal" ? TERMINAL : input.target.trim(), input.subject?.trim() || null, input.body, deliverAt, input.idempotencyKey ?? null],
    );
    await entry(q, accountId, period, -1, "Bottle sent", `bottle:${id}`);
    return { bottle, created: true };
  });
}

export async function listBottles(db: Db, accountId: string, limit = 50): Promise<Bottle[]> {
  return db.query<Bottle & Record<string, unknown>>(
    `SELECT * FROM bottles WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [accountId, limit],
  );
}

/** Cancel a bottle that has not gone out yet, and give the unit back. */
export async function cancelBottle(db: Db, accountId: string, id: string, now = new Date()): Promise<boolean> {
  return db.tx(async (q) => {
    const rows = await q.query(
      `UPDATE bottles SET status = 'cancelled', locked_until = NULL
        WHERE id = $1 AND account_id = $2 AND status = 'scheduled'
        RETURNING id`,
      [id, accountId],
    );
    if (rows.length === 0) return false;
    await entry(q, accountId, periodOf(now), 1, "Bottle cancelled", `refund:${id}`);
    return true;
  });
}
