import assert from "node:assert/strict";
import { test } from "node:test";
import { billingHandlers } from "../src/lib/billing";
import { connectLocal, type Db } from "../src/lib/db";
import { accept, drain, replay, type Handler } from "../src/lib/intake";
import { balance, entry } from "../src/lib/quota";

const T0 = new Date("2026-10-05T10:00:00Z");
const at = (minutes: number) => new Date(+T0 + minutes * 60_000);

async function setup(): Promise<Db> {
  const db = await connectLocal();
  await db.query(`INSERT INTO accounts (id, email) VALUES ('kp_ada', 'ada@example.com')`);
  return db;
}

const event = (key: string, type: string, minutes: number, data: Record<string, unknown> = {}) => ({
  source: "kinde",
  dedupeKey: key,
  type,
  occurredAt: at(minutes),
  receivedAt: T0,
  payload: { type, data: { user_id: "kp_ada", ...data } },
});

const plan = async (db: Db) => (await db.query<{ plan: string }>(`SELECT plan FROM accounts WHERE id = 'kp_ada'`))[0].plan;

test("a second copy of an event is stored once and counted as a duplicate", async () => {
  const db = await setup();
  const first = await accept(db, event("wh_1", "customer.payment_succeeded", 0));
  const second = await accept(db, event("wh_1", "customer.payment_succeeded", 0));
  const third = await accept(db, event("wh_1", "customer.payment_succeeded", 0));
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(third.eventId, first.eventId);
  const [row] = await db.query<{ seen_count: number }>(`SELECT seen_count FROM inbox_events`);
  assert.equal(row.seen_count, 3);
  const receipts = await db.query<{ outcome: string }>(`SELECT outcome FROM inbox_receipts ORDER BY id`);
  assert.deepEqual(receipts.map((r) => r.outcome), ["accepted", "duplicate", "duplicate"]);
  await db.close();
});

test("a payment that arrives five times grants the allowance once", async () => {
  const db = await setup();
  await accept(db, event("wh_plan", "customer.plan_changed", 0, { plan_code: "pro" }));
  for (let i = 0; i < 5; i++) await accept(db, event("wh_pay", "customer.payment_succeeded", 1));
  // The same payment under a new delivery id is a different delivery of the same fact.
  await accept(db, event("wh_pay_again", "customer.payment_succeeded", 2));
  const result = await drain(db, billingHandlers, { now: at(5) });
  assert.equal(result.applied, 3);
  assert.equal(await plan(db), "pro");
  assert.equal(await balance(db, "kp_ada", "2026-10"), 500);
  await db.close();
});

test("an older plan change that arrives late does not replace a newer one", async () => {
  const db = await setup();
  await accept(db, event("wh_new", "customer.plan_changed", 10, { plan_code: "pro" }));
  await drain(db, billingHandlers, { now: at(11) });
  await accept(db, event("wh_old", "customer.agreement_cancelled", 3));
  const result = await drain(db, billingHandlers, { now: at(12) });
  assert.equal(result.ignored, 1);
  assert.equal(await plan(db), "pro");
  await db.close();
});

test("a handler that fails leaves no partial effect and runs again later", async () => {
  const db = await setup();
  let calls = 0;
  const flaky: Record<string, Handler> = {
    "test.grant": async (q) => {
      calls += 1;
      await entry(q, "kp_ada", "2026-10", 7, "test", "test:grant");
      if (calls === 1) throw new Error("the process stopped here");
      return "granted";
    },
  };
  await accept(db, { source: "kinde", dedupeKey: "wh_f", type: "test.grant", occurredAt: at(0), receivedAt: T0, payload: {} });

  const first = await drain(db, flaky, { now: at(1) });
  assert.equal(first.failed, 1);
  assert.equal(await balance(db, "kp_ada", "2026-10"), 0, "the write from the failed run was rolled back");

  const tooSoon = await drain(db, flaky, { now: at(1) });
  assert.equal(tooSoon.applied + tooSoon.failed, 0, "the retry waits for its back-off");

  const second = await drain(db, flaky, { now: at(2) });
  assert.equal(second.applied, 1);
  assert.equal(await balance(db, "kp_ada", "2026-10"), 7);
  await db.close();
});

test("an event that was claimed but never finished is claimed again", async () => {
  const db = await setup();
  await accept(db, event("wh_stuck", "customer.plan_changed", 0, { plan_code: "pro" }));
  await db.query(`UPDATE inbox_events SET status = 'processing', locked_until = $1`, [at(1)]);
  assert.equal((await drain(db, billingHandlers, { now: at(0.5) })).applied, 0, "the lease is still held");
  assert.equal((await drain(db, billingHandlers, { now: at(2) })).applied, 1);
  assert.equal(await plan(db), "pro");
  await db.close();
});

test("a replay runs the event again and changes nothing", async () => {
  const db = await setup();
  await accept(db, event("wh_plan", "customer.plan_changed", 0, { plan_code: "pro" }));
  const paid = await accept(db, event("wh_pay", "customer.payment_succeeded", 1));
  await drain(db, billingHandlers, { now: at(2) });
  assert.equal(await balance(db, "kp_ada", "2026-10"), 500);

  assert.equal(await replay(db, paid.eventId, at(3)), true);
  const again = await drain(db, billingHandlers, { now: at(3) });
  assert.equal(again.applied, 1);
  assert.equal(await balance(db, "kp_ada", "2026-10"), 500);
  const [row] = await db.query<{ replays: number; result: string }>(`SELECT replays, result FROM inbox_events WHERE id = $1`, [paid.eventId]);
  assert.equal(row.replays, 1);
  assert.match(row.result, /already granted/);
  await db.close();
});

test("an event for an unknown customer is kept and marked ignored", async () => {
  const db = await setup();
  await accept(db, { source: "kinde", dedupeKey: "wh_x", type: "customer.payment_failed", occurredAt: at(0), receivedAt: T0, payload: { data: { user_id: "kp_nobody" } } });
  const result = await drain(db, billingHandlers, { now: at(1) });
  assert.equal(result.ignored, 1);
  await db.close();
});
