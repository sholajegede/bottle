import { after } from "next/server";
import { billingHandlers } from "@/lib/billing";
import { db } from "@/lib/db";
import { accept, drain } from "@/lib/intake";
import { verifyWebhook } from "@/lib/kinde";

/**
 * Kinde billing events arrive here.
 *
 *   1. Check the signature. A request that fails is refused and nothing is stored.
 *   2. Store the event. The webhook-id header is the same on every retry, so it is the dedupe key.
 *   3. Answer 200. From this point Kinde stops retrying, and the event is safe in the database.
 *   4. Apply the event after the response. If that fails, the tick applies it later.
 */
export async function POST(request: Request) {
  const body = await request.text();

  let event;
  try {
    event = await verifyWebhook(body);
  } catch {
    return Response.json({ error: "The signature is not valid." }, { status: 401 });
  }

  const dedupeKey = request.headers.get("webhook-id") ?? event.eventId;
  if (!dedupeKey) return Response.json({ error: "The event has no id." }, { status: 400 });

  const database = await db();
  const { duplicate } = await accept(database, {
    source: "kinde",
    dedupeKey,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });

  after(() => drain(database, billingHandlers).catch((error) => console.error("[bottle] drain failed", error)));
  return Response.json({ received: true, duplicate });
}
