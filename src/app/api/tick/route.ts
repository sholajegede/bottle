import { billingHandlers } from "@/lib/billing";
import { db } from "@/lib/db";
import { tick } from "@/lib/deliver";
import { drain } from "@/lib/intake";

/**
 * One turn of the clock. Something calls this every minute:
 * `npm run dev` does it on your machine, and the Worker in ticker/ does it in production.
 * It sends the bottles that are due and applies any stored event that was not applied yet.
 */
async function run(request: Request) {
  const secret = process.env.TICK_SECRET;
  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "Not allowed." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "TICK_SECRET is not set." }, { status: 503 });
  }
  const database = await db();
  const events = await drain(database, billingHandlers);
  const bottles = await tick(database);
  return Response.json({ events, bottles });
}

export const POST = run;
export const GET = run;
