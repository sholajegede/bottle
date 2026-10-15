import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { db } from "./db";
import { kindeReady, profileEmail, verifyAccessToken } from "./kinde";
import type { Plan } from "./quota";

export interface Account {
  id: string;
  email: string | null;
  plan: Plan;
  billing_state: "ok" | "past_due";
}

/** The token the CLI uses against a local server that has no Kinde settings. */
export const LOCAL_TOKEN = "local-dev";

async function upsert(id: string, email: string | null): Promise<Account> {
  const database = await db();
  const [row] = await database.query<Account & Record<string, unknown>>(
    `INSERT INTO accounts (id, email) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET email = COALESCE(EXCLUDED.email, accounts.email)
     RETURNING id, email, plan, billing_state`,
    [id, email],
  );
  return row;
}

/**
 * The signed-in account, or null.
 * A request with a Bearer token (the CLI and the API) is checked against Kinde's keys.
 * Without Kinde settings, and only outside production, a local account is used so the app runs with no setup.
 */
export async function currentAccount(request?: Request): Promise<Account | null> {
  const bearer = request?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    if (!kindeReady()) {
      // With no Kinde settings, the CLI signs in to a local server with this token.
      if (process.env.NODE_ENV !== "production" && bearer === LOCAL_TOKEN) return upsert("local_dev", "you@example.com");
      return null;
    }
    try {
      const id = await verifyAccessToken(bearer);
      const account = await upsert(id, null);
      if (account.email) return account;
      // An access token carries no email. Ask Kinde once, so email bottles have a default address.
      return upsert(id, await profileEmail(bearer));
    } catch {
      return null;
    }
  }
  if (!kindeReady()) {
    if (process.env.NODE_ENV === "production") return null;
    return upsert("local_dev", "you@example.com");
  }
  const user = await getKindeServerSession().getUser();
  if (!user?.id) return null;
  return upsert(user.id, user.email ?? null);
}
