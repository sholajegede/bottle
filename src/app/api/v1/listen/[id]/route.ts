import { currentAccount } from "@/lib/auth";
import { db } from "@/lib/db";
import { acknowledge } from "@/lib/deliver";
import { ackRelay } from "@/lib/relay";

/** The listener's answer for one attempt of a terminal bottle (btl_) or a relay event (rev_): { attempt, ok, detail }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  let input: { attempt?: unknown; ok?: unknown; detail?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return Response.json({ error: "Send the answer as JSON." }, { status: 400 });
  }
  const attempt = Number(input.attempt);
  if (!Number.isInteger(attempt) || attempt < 1) return Response.json({ error: "Give the attempt number." }, { status: 400 });
  const detail = String(input.detail ?? (input.ok ? "Received by bottle listen." : "bottle listen could not deliver it.")).slice(0, 500);
  const answer = id.startsWith("rev_") ? ackRelay : acknowledge;
  const state = await answer(await db(), account.id, id, attempt, { ok: input.ok === true, detail });
  if (state === "missing") return Response.json({ error: "Nothing with this id is waiting for you." }, { status: 404 });
  // "stale" means the lease ended and the bottle was given out again. This answer is ignored.
  return Response.json({ state }, { status: state === "stale" ? 409 : 200 });
}
