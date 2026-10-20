import type { Queryable } from "./db";
import type { Handler, StoredEvent } from "./intake";
import { grantFree, grantPro, isPlan, periodOf, type Plan } from "./quota";

/**
 * What each Kinde billing event does to an account.
 *
 * Two rules keep the state right when events repeat or come in the wrong order:
 *   1. A plan change applies only when it is newer than the change already stored.
 *   2. A quota grant is a ledger entry with a key for the account and the month,
 *      so it counts once however many events ask for it.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Find the first string under one of the given keys, looking a few levels into the payload. */
export function pick(value: unknown, keys: string[], depth = 4): string | undefined {
  if (!isObject(value) || depth < 0) return undefined;
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" && found) return found;
  }
  for (const child of Object.values(value)) {
    const found = pick(child, keys, depth - 1);
    if (found) return found;
  }
  return undefined;
}

const data = (event: StoredEvent) => (isObject(event.payload.data) ? event.payload.data : event.payload);

/** Map the plan code in an event to a Bottle plan. PRO_PLAN_CODE names the paid plan in Kinde. */
export function planFrom(event: StoredEvent): Plan | undefined {
  const body = data(event);
  // Kinde sends the plan as an object: data.plan.key. Older shapes carry a flat plan_code.
  const code = pick(isObject(body.plan) ? body.plan : undefined, ["key", "code"]) ?? pick(body, ["plan_code", "plan_key", "plan"]);
  if (!code) return undefined;
  if (isPlan(code)) return code;
  return code === (process.env.KINDE_PRO_PLAN_CODE ?? "pro") ? "pro" : "free";
}

async function accountFor(q: Queryable, event: StoredEvent): Promise<{ id: string; plan: Plan } | undefined> {
  const body = data(event);
  const userId = pick(body, ["user_id", "kp_id", "sub"]) ?? pick(isObject(body.user) ? body.user : undefined, ["id"]);
  const customerId = pick(body, ["customer_id"]) ?? pick(isObject(body.customer) ? body.customer : undefined, ["id"]);
  const rows = await q.query<{ id: string; plan: Plan }>(
    `SELECT id, plan FROM accounts WHERE id = $1 OR ($2::text IS NOT NULL AND customer_id = $2) LIMIT 1 FOR UPDATE`,
    [userId ?? "", customerId ?? null],
  );
  if (rows[0]) {
    if (customerId) await q.query(`UPDATE accounts SET customer_id = $2 WHERE id = $1 AND customer_id IS NULL`, [rows[0].id, customerId]);
    await q.query(`UPDATE inbox_events SET account_id = $2 WHERE id = $1`, [event.id, rows[0].id]);
  }
  return rows[0];
}

async function setPlan(q: Queryable, event: StoredEvent, accountId: string, plan: Plan): Promise<string> {
  const changed = await q.query(
    `UPDATE accounts SET plan = $2, plan_changed_at = $3 WHERE id = $1 AND plan_changed_at < $3 RETURNING id`,
    [accountId, plan, event.occurred_at],
  );
  if (changed.length === 0) return "ignored: a newer plan change is already stored";
  const period = periodOf(new Date(event.occurred_at));
  await grantFree(q, accountId, period);
  const granted = plan === "pro" ? await grantPro(q, accountId, period) : false;
  return `plan set to ${plan}${granted ? ", Pro allowance granted" : ""}`;
}

const planEvent: Handler = async (q, event) => {
  const account = await accountFor(q, event);
  if (!account) return "ignored: no account matches this customer";
  const plan = planFrom(event);
  if (!plan) return "ignored: the event has no plan code";
  return setPlan(q, event, account.id, plan);
};

export const billingHandlers: Record<string, Handler> = {
  "customer.plan_assigned": planEvent,
  "customer.plan_changed": planEvent,
  "customer.agreement_created": planEvent,

  "customer.agreement_cancelled": async (q, event) => {
    const account = await accountFor(q, event);
    if (!account) return "ignored: no account matches this customer";
    return setPlan(q, event, account.id, "free");
  },

  "customer.payment_succeeded": async (q, event) => {
    const account = await accountFor(q, event);
    if (!account) return "ignored: no account matches this customer";
    await q.query(`UPDATE accounts SET billing_state = 'ok' WHERE id = $1`, [account.id]);
    const period = periodOf(new Date(event.occurred_at));
    await grantFree(q, account.id, period);
    if (account.plan !== "pro") return "payment recorded";
    const granted = await grantPro(q, account.id, period);
    return granted ? "payment recorded, Pro allowance granted" : "payment recorded, allowance was already granted";
  },

  "customer.payment_failed": async (q, event) => {
    const account = await accountFor(q, event);
    if (!account) return "ignored: no account matches this customer";
    await q.query(`UPDATE accounts SET billing_state = 'past_due' WHERE id = $1`, [account.id]);
    return "payment failure recorded";
  },

  "customer.invoice_overdue": async (q, event) => {
    const account = await accountFor(q, event);
    if (!account) return "ignored: no account matches this customer";
    await q.query(`UPDATE accounts SET billing_state = 'past_due' WHERE id = $1`, [account.id]);
    return "overdue invoice recorded";
  },
};
