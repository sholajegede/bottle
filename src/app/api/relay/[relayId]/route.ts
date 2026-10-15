import { db } from "@/lib/db";
import { receive, RelayError } from "@/lib/relay";

/**
 * Point your own Kinde app's webhooks here. Bottle checks the signature against your Kinde
 * domain, stores one row for each webhook-id and answers 200. `bottle listen` delivers it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ relayId: string }> }) {
  const { relayId } = await params;
  const token = await request.text();
  if (token.length > 256_000) return Response.json({ error: "The event is too large." }, { status: 413 });
  try {
    const result = await receive(await db(), relayId, token, request.headers.get("webhook-id"));
    return Response.json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof RelayError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
