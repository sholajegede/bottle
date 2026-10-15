import { currentAccount } from "@/lib/auth";
import { cancelBottle } from "@/lib/bottles";
import { db } from "@/lib/db";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const cancelled = await cancelBottle(await db(), account.id, id);
  if (!cancelled) return Response.json({ error: "This bottle has already gone out or does not exist." }, { status: 409 });
  return Response.json({ cancelled: true });
}
