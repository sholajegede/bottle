"use client";

import { Mail, SquareTerminal, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface BottleView {
  id: string;
  kind: "email" | "webhook" | "terminal";
  target: string;
  subject: string | null;
  body: string;
  deliver_at: string;
  status: "scheduled" | "sending" | "delivered" | "failed" | "cancelled";
  attempts: number;
  delivered_at: string | null;
  last_error: string | null;
}

const tone: Record<BottleView["status"], string> = {
  scheduled: "text-glass border-glass/40",
  sending: "text-sun border-sun/40",
  delivered: "text-moss border-moss/40",
  failed: "text-coral border-coral/40",
  cancelled: "text-soft border-line",
};

const word: Record<BottleView["status"], string> = {
  scheduled: "Waiting",
  sending: "Sending",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function BottleList({ bottles }: { bottles: BottleView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the list fresh while something is still on its way.
  const pending = bottles.some((bottle) => bottle.status === "scheduled" || bottle.status === "sending");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [pending, router]);

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    const response = await fetch(`/api/v1/bottles/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setError("Bottle could not cancel this. It may have gone out already.");
    setBusy(null);
    router.refresh();
  }

  if (bottles.length === 0) {
    return <p className="panel p-6 text-sm text-soft">No bottles yet. Write your first one.</p>;
  }

  return (
    <div>
      {error && <p role="alert" className="mb-3 text-sm text-coral">{error}</p>}
      <ul className="space-y-2.5">
        {bottles.map((bottle) => {
          const Icon = bottle.kind === "email" ? Mail : bottle.kind === "terminal" ? SquareTerminal : Webhook;
          return (
            <li key={bottle.id} className="panel min-w-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Icon size={15} className="shrink-0 text-soft" aria-hidden />
                  <span className="truncate">{bottle.kind === "terminal" ? "Your terminal" : bottle.target}</span>
                </p>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[0.7rem] ${tone[bottle.status]}`}>{word[bottle.status]}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-soft [overflow-wrap:anywhere]">{bottle.subject ? `${bottle.subject}: ` : ""}{bottle.body}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
                <span>
                  {bottle.status === "delivered" && bottle.delivered_at
                    ? `Delivered ${time(bottle.delivered_at)}`
                    : `${bottle.status === "cancelled" ? "Was due" : "Due"} ${time(bottle.deliver_at)}`}
                  {bottle.attempts > 1 ? `, ${bottle.attempts} tries` : ""}
                </span>
                {bottle.status === "scheduled" && (
                  <button onClick={() => cancel(bottle.id)} disabled={busy === bottle.id} className="text-soft underline decoration-white/25 underline-offset-4 hover:text-ink">
                    {busy === bottle.id ? "Cancelling" : "Cancel"}
                  </button>
                )}
              </div>
              {bottle.last_error && bottle.status !== "delivered" && (
                <p className="mt-2 text-xs text-coral [overflow-wrap:anywhere]">Last try: {bottle.last_error}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
