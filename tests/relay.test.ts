import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { connectLocal } from "../src/lib/db";
import { LISTEN_LEASE_SECONDS } from "../src/lib/deliver";
import { ackRelay, claimRelay, receive, relayInfo, RelayError } from "../src/lib/relay";

// A stand-in for a Kinde domain: it publishes one signing key at /.well-known/jwks.
async function fakeKinde() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const server = createServer((_req, res) => {
    res.setHeader("connection", "close");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const domain = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sign = (type: string, key = privateKey) =>
    new SignJWT({ type, event_id: `evt_${type}`, data: { customer: { id: "cus_1" } } })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .sign(key);
  return { domain, sign, close: () => server.close() };
}

const NOW = new Date("2026-10-05T10:00:00Z");
const at = (seconds: number) => new Date(+NOW + seconds * 1000);

async function setup() {
  const db = await connectLocal();
  const kinde = await fakeKinde();
  await db.query(`INSERT INTO accounts (id) VALUES ('kp_ada')`);
  const { relay_id } = await relayInfo(db, "kp_ada");
  await db.query(`UPDATE accounts SET relay_issuer = $1 WHERE id = 'kp_ada'`, [kinde.domain]);
  return { db, kinde, relayId: relay_id };
}

test("a Kinde retry is stored once, counted, and given to the listener once", async () => {
  const { db, kinde, relayId } = await setup();
  const token = await kinde.sign("customer.invoice.paid");
  const first = await receive(db, relayId, token, "wh_1", NOW);
  const second = await receive(db, relayId, token, "wh_1", NOW);
  const third = await receive(db, relayId, token, "wh_1", NOW);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(third.copies, 3);
  assert.equal(first.id, third.id);

  const claimed = await claimRelay(db, "kp_ada", at(1));
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].dedupe_key, "wh_1");
  assert.equal(claimed[0].token, token, "the listener gets the JWT exactly as Kinde sent it");
  assert.equal(await ackRelay(db, "kp_ada", claimed[0].id, claimed[0].attempts, { ok: true, detail: "ok" }, at(2)), "delivered");

  await receive(db, relayId, token, "wh_1", NOW);
  assert.equal((await claimRelay(db, "kp_ada", at(100))).length, 0, "a copy after delivery is not delivered again");
  kinde.close();
  await db.close();
});

test("the relay refuses a bad signature, an unknown address, and an account with no Kinde domain", async () => {
  const { db, kinde, relayId } = await setup();
  const other = await generateKeyPair("RS256");
  const forged = await kinde.sign("customer.plan.changed", other.privateKey);
  await assert.rejects(receive(db, relayId, forged, "wh_2"), (e: RelayError) => e.status === 401);
  await assert.rejects(receive(db, "rly_nope", await kinde.sign("x"), "wh_3"), (e: RelayError) => e.status === 404);
  await db.query(`INSERT INTO accounts (id) VALUES ('kp_bo')`);
  const bo = await relayInfo(db, "kp_bo");
  await assert.rejects(receive(db, bo.relay_id, await kinde.sign("x"), "wh_4"), (e: RelayError) => e.status === 409);
  assert.equal((await db.query(`SELECT id FROM relay_events`)).length, 0, "nothing is stored");
  kinde.close();
  await db.close();
});

test("an event the listener did not answer comes again with the same webhook-id", async () => {
  const { db, kinde, relayId } = await setup();
  await receive(db, relayId, await kinde.sign("customer.subscription.created"), "wh_5", NOW);
  const [first] = await claimRelay(db, "kp_ada", at(1));
  const [second] = await claimRelay(db, "kp_ada", at(2 + LISTEN_LEASE_SECONDS));
  assert.equal(second.dedupe_key, first.dedupe_key);
  assert.equal(second.attempts, 2);
  assert.equal(await ackRelay(db, "kp_ada", first.id, 1, { ok: true, detail: "late" }, at(40)), "stale");
  assert.equal(await ackRelay(db, "kp_ada", first.id, 2, { ok: false, detail: "500" }, at(41)), "retrying");
  kinde.close();
  await db.close();
});
