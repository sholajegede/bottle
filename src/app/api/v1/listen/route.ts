import { currentAccount } from "@/lib/auth";
import { db } from "@/lib/db";
import { claimForListener, LISTEN_LEASE_SECONDS } from "@/lib/deliver";
import { claimRelay } from "@/lib/relay";

/**
 * `bottle listen` calls this every few seconds. It returns what is due for this account,
 * each item with a lease: terminal bottles, and Kinde webhooks that came in through the relay.
 * The listener answers for each attempt at /api/v1/listen/{id}.
 * If no answer comes before the lease ends, the item is given out again with the same id.
 */
export async function POST(request: Request) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const database = await db();
  const [bottles, events] = await Promise.all([claimForListener(database, account.id), claimRelay(database, account.id)]);
  return Response.json({
    lease_seconds: LISTEN_LEASE_SECONDS,
    bottles: bottles.map((bottle) => ({
      id: bottle.id,
      attempt: bottle.attempts,
      subject: bottle.subject,
      body: bottle.body,
      deliver_at: new Date(bottle.deliver_at).toISOString(),
      created_at: new Date(bottle.created_at).toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      attempt: event.attempts,
      webhook_id: event.dedupe_key,
      type: event.type,
      copies: event.seen_count,
      token: event.token,
      payload: event.payload,
      received_at: new Date(event.received_at).toISOString(),
    })),
  });
}
