import type { Metadata } from "next";
import { Frame, SiteFooter, SiteNav } from "@/components/site-chrome";
import { Storm } from "@/components/storm";
import { Band, Eyebrow } from "@/components/ui";
import { db } from "@/lib/db";
import { feed } from "@/lib/storm";

export const metadata: Metadata = {
  title: "Engine Room",
  description: "Watch Bottle receive the same billing event many times, in the wrong order, and apply it once.",
};

export const dynamic = "force-dynamic";

const rules: Array<[string, string, string]> = [
  [
    "Store, then answer",
    "The endpoint checks the signature, writes the event, and only then answers 200. Kinde retries until it gets that 200, so no event is lost between the two systems.",
    `INSERT INTO inbox_events (source, dedupe_key, ...)
ON CONFLICT (source, dedupe_key)
DO UPDATE SET seen_count = inbox_events.seen_count + 1`,
  ],
  [
    "One key for each event",
    "Kinde sends a webhook-id header that stays the same on every retry. That header is the dedupe key. A second copy adds one to a counter and does nothing else.",
    `const dedupeKey = request.headers.get("webhook-id")`,
  ],
  [
    "The effect and the mark commit together",
    "A worker claims an event with a lease and applies it in one transaction. If the worker stops half way, the database rolls back and the event runs again when the lease ends.",
    `SELECT id FROM inbox_events WHERE ...
FOR UPDATE SKIP LOCKED`,
  ],
  [
    "Effects are safe to repeat",
    "A grant is a ledger row with a key for the account and the month. A plan change applies only if it is newer than the one stored. So a replay changes nothing.",
    `INSERT INTO ledger (..., entry_key)
VALUES (..., 'pro:kp_123:2026-10')
ON CONFLICT (entry_key) DO NOTHING`,
  ],
];

export default async function EngineRoom() {
  const { totals, recent } = await feed(await db());
  const stats: Array<[string, number]> = [
    ["Events stored", totals.events],
    ["Copies received", totals.copies],
    ["Duplicates dropped", totals.duplicates],
    ["Waiting to apply", totals.waiting],
  ];

  return (
    <Frame>
      <SiteNav />
      <Band rule={false} inner="hero grain !px-5 py-14 text-center sm:py-20">
        <div className="relative">
          <div className="flex justify-center">
            <Eyebrow color="#f5b94a">Engine Room</Eyebrow>
          </div>
          <h1 className="serif mx-auto mt-5 max-w-[18ch] text-[clamp(2.4rem,7vw,4rem)]">Nine copies arrive. One change is made.</h1>
          <p className="mx-auto mt-6 max-w-[520px] text-[0.98rem] leading-[1.7] text-ink/85">
            Billing events can arrive twice, late, or in the wrong order. This page runs that case against the same code that handles real Kinde
            events, and shows you each step.
          </p>
        </div>
      </Band>

      <Band inner="py-12 sm:py-16">
        <Storm />
      </Band>

      <Band inner="py-12 sm:py-16">
        <h2 className="serif text-[clamp(1.8rem,4.5vw,2.6rem)]">The four rules behind it</h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {rules.map(([title, text, code], index) => (
            <article key={title} className="panel flex min-w-0 flex-col p-6">
              <p className="label">Rule {index + 1}</p>
              <h3 className="serif mt-3 text-[1.4rem]">{title}</h3>
              <p className="mt-2.5 flex-1 text-sm leading-relaxed text-soft">{text}</p>
              <pre className="mt-5 overflow-x-auto rounded-[9px] border border-line bg-black/30 p-3.5 text-[12px] leading-relaxed text-ink/85">{code}</pre>
            </article>
          ))}
        </div>
      </Band>

      <Band inner="py-12 sm:py-16">
        <h2 className="serif text-[clamp(1.8rem,4.5vw,2.6rem)]">Real Kinde events on this server</h2>
        <p className="mt-3 max-w-[560px] text-sm text-soft">Types and counts only. Bottle does not show payloads or account details here.</p>
        <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="panel px-4 py-5 text-center">
              <dd className="serif text-[2.2rem]">{value.toLocaleString("en")}</dd>
              <dt className="mt-1 text-xs text-soft">{label}</dt>
            </div>
          ))}
        </dl>
        <div className="panel mt-3 overflow-hidden text-[12.5px]">
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-soft">No Kinde events have arrived yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="text-ink/90">{event.type}</span>
                  <span className="text-soft">{event.result ?? event.status}</span>
                  {event.seen > 1 && <span className="ml-auto text-sun">{event.seen} copies</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Band>
      <SiteFooter />
    </Frame>
  );
}
