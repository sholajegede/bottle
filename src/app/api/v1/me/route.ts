import { currentAccount } from "@/lib/auth";
import { db } from "@/lib/db";
import { balance, grantFree, periodOf, PLANS } from "@/lib/quota";

/** The signed-in account, its plan and the bottles left this month. */
export async function GET(request: Request) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const database = await db();
  const period = periodOf(new Date());
  const left = await database.tx(async (q) => {
    await grantFree(q, account.id, period);
    return balance(q, account.id, period);
  });
  return Response.json({
    id: account.id,
    email: account.email,
    plan: account.plan,
    plan_name: PLANS[account.plan].name,
    billing_state: account.billing_state,
    left,
    period,
  });
}
