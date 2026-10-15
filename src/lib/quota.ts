import type { Queryable } from "./db";

export const PLANS = {
  free: { name: "Free", monthly: 10 },
  pro: { name: "Pro", monthly: 500 },
} as const;

export type Plan = keyof typeof PLANS;

export const isPlan = (value: unknown): value is Plan => value === "free" || value === "pro";

export const periodOf = (date: Date) => date.toISOString().slice(0, 7);

/**
 * Add one ledger entry. entry_key is unique, so the same grant or spend can be written
 * any number of times and it counts once. Returns true when this call wrote the row.
 */
export async function entry(
  q: Queryable,
  accountId: string,
  period: string,
  delta: number,
  reason: string,
  entryKey: string,
): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO ledger (account_id, period, delta, reason, entry_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entry_key) DO NOTHING
     RETURNING id`,
    [accountId, period, delta, reason, entryKey],
  );
  return rows.length > 0;
}

/** Every account gets the free allowance once for each month. */
export const grantFree = (q: Queryable, accountId: string, period: string) =>
  entry(q, accountId, period, PLANS.free.monthly, "Free allowance", `free:${accountId}:${period}`);

/** A Pro account gets the rest of the Pro allowance once for each month. */
export const grantPro = (q: Queryable, accountId: string, period: string) =>
  entry(q, accountId, period, PLANS.pro.monthly - PLANS.free.monthly, "Pro allowance", `pro:${accountId}:${period}`);

export async function balance(q: Queryable, accountId: string, period: string): Promise<number> {
  const [row] = await q.query<{ total: string | number | null }>(
    `SELECT COALESCE(SUM(delta), 0) AS total FROM ledger WHERE account_id = $1 AND period = $2`,
    [accountId, period],
  );
  return Number(row?.total ?? 0);
}
