import { currentAccount } from "@/lib/auth";
import { BottleError, createBottle, listBottles, type Bottle } from "@/lib/bottles";
import { db } from "@/lib/db";

const view = (bottle: Bottle) => ({
  id: bottle.id,
  kind: bottle.kind,
  target: bottle.target,
  subject: bottle.subject,
  body: bottle.body,
  deliver_at: new Date(bottle.deliver_at).toISOString(),
  status: bottle.status,
  attempts: bottle.attempts,
  delivered_at: bottle.delivered_at ? new Date(bottle.delivered_at).toISOString() : null,
  last_error: bottle.last_error,
  created_at: new Date(bottle.created_at).toISOString(),
});

export async function GET(request: Request) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const bottles = await listBottles(await db(), account.id);
  return Response.json({ bottles: bottles.map(view) });
}

export async function POST(request: Request) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send the bottle as JSON." }, { status: 400 });
  }

  try {
    const { bottle, created } = await createBottle(await db(), account.id, {
      kind: input.kind === "webhook" || input.kind === "terminal" ? input.kind : "email",
      target: String(input.target ?? account.email ?? ""),
      subject: typeof input.subject === "string" ? input.subject : undefined,
      body: String(input.body ?? ""),
      deliverAt: new Date(String(input.deliver_at ?? "")),
      idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
    });
    return Response.json({ bottle: view(bottle), created }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof BottleError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
