import { db } from "@/lib/db";
import { runStorm } from "@/lib/storm";

const recent = new Map<string, number>();

export async function POST(request: Request) {
  const who = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  if (now - (recent.get(who) ?? 0) < 3000) {
    return Response.json({ error: "Wait a few seconds, then run it again." }, { status: 429 });
  }
  recent.set(who, now);
  if (recent.size > 5000) recent.clear();
  return Response.json(await runStorm(await db()));
}
