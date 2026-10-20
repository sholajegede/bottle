import { after } from "next/server";
import { currentAccount } from "@/lib/auth";
import { billingHandlers } from "@/lib/billing";
import { db } from "@/lib/db";
import { drain, replay } from "@/lib/intake";

/** Put one of the account's own billing events back in the queue. The handlers are safe to repeat, so a replay changes nothing it should not. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "This event does not exist." }, { status: 404 });
  const database = await db();
  const queued = await replay(database, id, new Date(), account.id);
  if (!queued) return Response.json({ error: "This event is not yours, or it is still waiting to apply." }, { status: 409 });
  after(() => drain(database, billingHandlers).catch((error) => console.error("[bottle] drain failed", error)));
  return Response.json({ queued: true });
}
