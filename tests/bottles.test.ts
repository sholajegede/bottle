import assert from "node:assert/strict";
import { test } from "node:test";
import { BottleError, cancelBottle, createBottle, type Bottle } from "../src/lib/bottles";
import { connectLocal, type Db } from "../src/lib/db";
import { MAX_SENDS, tick } from "../src/lib/deliver";
import { isPrivateAddress } from "../src/lib/net";
import { balance } from "../src/lib/quota";

const NOW = new Date("2026-10-05T10:00:00Z");
const at = (minutes: number) => new Date(+NOW + minutes * 60_000);

async function setup(): Promise<Db> {
  const db = await connectLocal();
  await db.query(`INSERT INTO accounts (id, email) VALUES ('kp_ada', 'ada@example.com')`);
  return db;
}

const note = (minutes: number, extra: Record<string, unknown> = {}) => ({
  kind: "email" as const,
  target: "ada@example.com",
  body: "Call the bank.",
  deliverAt: at(minutes),
  ...extra,
});

test("a bottle spends one unit, and the same idempotency key spends nothing more", async () => {
  const db = await setup();
  const first = await createBottle(db, "kp_ada", note(30, { idempotencyKey: "k1" }), NOW);
  const second = await createBottle(db, "kp_ada", note(30, { idempotencyKey: "k1" }), NOW);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.bottle.id, first.bottle.id);
  assert.equal(await balance(db, "kp_ada", "2026-10"), 9);
  await db.close();
});

test("requests that race for the last units cannot spend more than the allowance", async () => {
  const db = await setup();
  const results = await Promise.allSettled(Array.from({ length: 15 }, () => createBottle(db, "kp_ada", note(30), NOW)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
  const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(refused.length, 5);
  assert.ok(refused.every((r) => r.reason instanceof BottleError && r.reason.status === 402));
  assert.equal(await balance(db, "kp_ada", "2026-10"), 0);
  await db.close();
});

test("a bottle goes out when it is due, and only once", async () => {
  const db = await setup();
  const { bottle } = await createBottle(db, "kp_ada", note(30), NOW);
  const sent: string[] = [];
  const sender = async (b: Bottle) => (sent.push(b.id), "ok");

  assert.equal((await tick(db, { now: at(29), sender })).delivered, 0);
  assert.equal((await tick(db, { now: at(30), sender })).delivered, 1);
  assert.equal((await tick(db, { now: at(31), sender })).delivered, 0);
  assert.deepEqual(sent, [bottle.id]);
  await db.close();
});

test("a failed send is tried again with the same id, then marked failed", async () => {
  const db = await setup();
  const { bottle } = await createBottle(db, "kp_ada", note(0), NOW);
  const ids = new Set<string>();
  let sends = 0;
  const sender = async (b: Bottle) => {
    ids.add(b.id);
    sends += 1;
    throw new Error("The address answered 503.");
  };
  let now = NOW;
  let last = { delivered: 0, retrying: 0, failed: 0 };
  for (let i = 0; i < MAX_SENDS; i++) {
    last = await tick(db, { now, sender });
    now = new Date(+now + 5 * 60 * 60_000);
  }
  assert.equal(sends, MAX_SENDS);
  assert.equal(last.failed, 1);
  assert.deepEqual([...ids], [bottle.id]);
  const [row] = await db.query<{ status: string; last_error: string }>(`SELECT status, last_error FROM bottles`);
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /503/);
  await db.close();
});

test("a send that stopped half way is picked up when its lease ends", async () => {
  const db = await setup();
  await createBottle(db, "kp_ada", note(0), NOW);
  await db.query(`UPDATE bottles SET status = 'sending', locked_until = $1`, [at(1)]);
  const sender = async () => "ok";
  assert.equal((await tick(db, { now: at(0.5), sender })).delivered, 0);
  assert.equal((await tick(db, { now: at(2), sender })).delivered, 1);
  await db.close();
});

test("cancelling a bottle gives the unit back once", async () => {
  const db = await setup();
  const { bottle } = await createBottle(db, "kp_ada", note(30), NOW);
  assert.equal(await cancelBottle(db, "kp_ada", bottle.id, NOW), true);
  assert.equal(await cancelBottle(db, "kp_ada", bottle.id, NOW), false);
  assert.equal(await balance(db, "kp_ada", "2026-10"), 10);
  assert.equal((await tick(db, { now: at(31), sender: async () => "ok" })).delivered, 0);
  await db.close();
});

test("bad input is refused with a plain reason", async () => {
  const db = await setup();
  await assert.rejects(createBottle(db, "kp_ada", note(-10), NOW), /in the past/);
  await assert.rejects(createBottle(db, "kp_ada", note(5, { target: "nope" }), NOW), /valid email/);
  await assert.rejects(createBottle(db, "kp_ada", { kind: "webhook", target: "ftp://x.test", body: "{}", deliverAt: at(5) }, NOW), /https/);
  await db.close();
});

test("private addresses are recognised", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(address), false, address);
});
