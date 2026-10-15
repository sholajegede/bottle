import { db } from "@/lib/db";
import { feed } from "@/lib/storm";

export async function GET() {
  return Response.json(await feed(await db()), { headers: { "cache-control": "no-store" } });
}
