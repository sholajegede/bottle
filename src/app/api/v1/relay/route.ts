import { currentAccount } from "@/lib/auth";
import { db } from "@/lib/db";
import { relayInfo, RelayError, setRelayDomain } from "@/lib/relay";
import { site } from "@/lib/site";

async function describe(accountId: string, request: Request) {
  // The public address of this server. Without NEXT_PUBLIC_SITE_URL, use the one the request came in on.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ? site.url : new URL(request.url).origin;
  const info = await relayInfo(await db(), accountId);
  return {
    url: `${origin}/api/relay/${info.relay_id}`,
    kinde_domain: info.relay_issuer,
    waiting: info.waiting,
    delivered: info.delivered,
    copies_received: info.copies,
  };
}

/** Your relay address and its counts. */
export async function GET(request: Request) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json(await describe(account.id, request));
}

/** Set the Kinde domain whose webhooks the relay accepts: { kinde_domain }. */
export async function POST(request: Request) {
  const account = await currentAccount(request);
  if (!account) return Response.json({ error: "Sign in first." }, { status: 401 });
  const input = (await request.json().catch(() => ({}))) as { kinde_domain?: unknown };
  try {
    await setRelayDomain(await db(), account.id, String(input.kinde_domain ?? ""));
    return Response.json(await describe(account.id, request));
  } catch (error) {
    if (error instanceof RelayError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
