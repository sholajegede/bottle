import assert from "node:assert/strict";
import { test } from "node:test";
import { createBottle } from "../src/lib/bottles";
import { connectLocal, type Db } from "../src/lib/db";
import { acknowledge, claimForListener, LISTEN_LEASE_SECONDS, tick } from "../src/lib/deliver";

const NOW = new Date("2026-10-05T10:00:00Z");
const at = (seconds: number) => new Date(+NOW + seconds * 1000);

async function setup(): Promise<Db> {
  const db = await connectLocal();
  await db.query(`INSERT INTO accounts (id, email) VALUES ('kp_ada', 'ada@example.com'), ('kp_bo', 'bo@example.com')`);
  return db;
}
const terminal = (seconds: number) => ({ kind: "terminal" as const, target: "", body: "Stand-up in 5", deliverAt: at(seconds) });
const status = async (db: Db, id: string) =>
  (await db.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM bottles WHERE id = $1`, [id]))[0];

test("the ticker leaves terminal bottles for the listener, and only the owner can collect them", async () => {
  const db = await setup();
  const { bottle } = await createBottle(db, "kp_ada", terminal(60), NOW);
  assert.equal(bottle.target, "terminal");
  const sent: string[] = [];
  await tick(db, { now: at(120), sender: async (b) => (sent.push(b.id), "ok") });
  assert.deepEqual(sent, []);
  assert.equal((await claimForListener(db, "kp_bo", at(120))).length, 0);
  assert.equal((await claimForListener(db, "kp_ada", at(30))).length, 0, "not due yet");
  const [claimed] = await claimForListener(db, "kp_ada", at(120));
  assert.equal(claimed.id, bottle.id);
  assert.equal(await acknowledge(db, "kp_ada", bottle.id, claimed.attempts, { ok: true, detail: "ok" }, at(121)), "delivered");
  assert.equal((await status(db, bottle.id)).status, "delivered");
  assert.equal((await claimForListener(db, "kp_ada", at(500))).length, 0, "a delivered bottle is not given out again");
  await db.close();
});

test("a listener that stops before it answers gets the same bottle again, and its late answer is ignored", async () => {
  const db = await setup();
  const { bottle } = await createBottle(db, "kp_ada", terminal(0), NOW);
  const [first] = await claimForListener(db, "kp_ada", at(1));
  assert.equal((await claimForListener(db, "kp_ada", at(2))).length, 0, "held by the lease");
  const [second] = await claimForListener(db, "kp_ada", at(2 + LISTEN_LEASE_SECONDS));
  assert.equal(second.id, first.id);
  assert.equal(second.attempts, first.attempts + 1);
  assert.equal(await acknowledge(db, "kp_ada", bottle.id, first.attempts, { ok: true, detail: "late" }, at(40)), "stale");
  assert.equal(await acknowledge(db, "kp_ada", bottle.id, second.attempts, { ok: true, detail: "ok" }, at(41)), "delivered");
  const tries = await db.query(`SELECT ok FROM bottle_attempts WHERE bottle_id = $1`, [bottle.id]);
  assert.equal(tries.length, 1, "one recorded delivery");
  await db.close();
});

test("a failed forward is tried again after the back-off with the same id", async () => {
  const db = await setup();
  const { bottle } = await createBottle(db, "kp_ada", terminal(0), NOW);
  const [first] = await claimForListener(db, "kp_ada", at(1));
  assert.equal(await acknowledge(db, "kp_ada", bottle.id, first.attempts, { ok: false, detail: "Your server answered 500." }, at(2)), "retrying");
  assert.equal((await claimForListener(db, "kp_ada", at(20))).length, 0, "waits for the back-off");
  const [again] = await claimForListener(db, "kp_ada", at(40));
  assert.equal(again.id, bottle.id);
  assert.equal(await acknowledge(db, "kp_bo", bottle.id, again.attempts, { ok: true, detail: "ok" }, at(41)), "missing");
  await db.close();
});
