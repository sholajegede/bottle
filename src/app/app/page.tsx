import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BottleList, type BottleView } from "@/components/bottle-list";
import { Compose } from "@/components/compose";
import { ReplayButton } from "@/components/replay-button";
import { Frame, signInHref, SiteFooter, SiteNav } from "@/components/site-chrome";
import { Band } from "@/components/ui";
import { currentAccount } from "@/lib/auth";
import { listBottles } from "@/lib/bottles";
import { db } from "@/lib/db";
import { kindeReady } from "@/lib/kinde";
import { balance, grantFree, periodOf, PLANS } from "@/lib/quota";

export const metadata: Metadata = { title: "Your bottles" };
export const dynamic = "force-dynamic";

export default async function AppPage() {
  const account = await currentAccount();
  if (!account) {
    if (kindeReady()) redirect(signInHref());
    return (
      <Frame>
        <SiteNav />
        <Band rule={false} inner="py-24 text-center">
          <h1 className="serif text-[2.4rem]">Sign-in is not set up yet</h1>
          <p className="mx-auto mt-4 max-w-[440px] text-sm text-soft">This server has no Kinde settings. Add them, then open this page again.</p>
        </Band>
      </Frame>
    );
  }

  const database = await db();
  const period = periodOf(new Date());
  await grantFree(database, account.id, period);
  const [left, bottles, events] = await Promise.all([
    balance(database, account.id, period),
    listBottles(database, account.id),
    database.query<{ id: string; type: string; status: string; seen_count: number; result: string | null; received_at: Date }>(
      `SELECT id, type, status, seen_count, result, received_at FROM inbox_events WHERE account_id = $1 ORDER BY id DESC LIMIT 8`,
      [account.id],
    ),
  ]);

  const views: BottleView[] = bottles.map((bottle) => ({
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
  }));

  return (
    <Frame>
      <SiteNav signedIn />
      <Band rule={false} inner="py-10 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label">
              {PLANS[account.plan].name} plan{account.billing_state === "past_due" ? ", payment needed" : ""}
            </p>
            <h1 className="serif mt-3 text-[clamp(2.2rem,6vw,3.2rem)]">Your bottles</h1>
          </div>
          <p className="text-sm text-soft">
            {account.email}
            {kindeReady() ? (
              <>
                {" · "}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- an API route, not a page */}
                <a href="/api/auth/logout" className="underline decoration-white/25 underline-offset-4 hover:text-ink">
                  Sign out
                </a>
              </>
            ) : (
              " · local account"
            )}
          </p>
        </div>

        <div className="mt-9 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="min-w-0">
            <Compose email={account.email} left={left} />
          </div>
          <div className="min-w-0">
            <BottleList bottles={views} />
            {events.length > 0 && (
              <div className="mt-8">
                <p className="label">Billing events for your account</p>
                <ul className="panel mt-3 divide-y divide-line text-[12.5px]">
                  {events.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="text-ink/90">{event.type}</span>
                      <span className="text-soft">{event.result ?? event.status}</span>
                      {event.seen_count > 1 && <span className="text-sun">arrived {event.seen_count} times, counted once</span>}
                      {event.status !== "received" && event.status !== "processing" && <ReplayButton id={event.id} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Band>
      <SiteFooter />
    </Frame>
  );
}
