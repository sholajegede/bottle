"use client";

import { useEffect, useRef, useState } from "react";
import type { StormResult, StormStep } from "@/lib/storm";

const short = (type: string) => type.replace("customer.", "");

export function Storm() {
  const [result, setResult] = useState<StormResult | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setShown(0);
    try {
      const response = await fetch("/api/engine/storm", { method: "POST" });
      const body = (await response.json()) as StormResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The storm did not run.");
      setResult(body);
      // The work is done on the server. The steps appear one at a time so you can read them.
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (still) setShown(body.steps.length);
      else {
        timer.current = setInterval(() => {
          setShown((n) => {
            if (n + 1 >= body.steps.length && timer.current) clearInterval(timer.current);
            return n + 1;
          });
        }, 650);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The storm did not run.");
    } finally {
      setBusy(false);
    }
  }

  const steps: StormStep[] = result ? result.steps.slice(0, shown) : [];
  const done = result !== null && shown >= result.steps.length;
  const current = steps[steps.length - 1];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={run} disabled={busy || (result !== null && !done)} className="btn btn-primary btn-lg">
          {busy ? "Starting" : result ? "Run it again" : "Run the storm"}
        </button>
        <p className="max-w-[420px] text-sm text-soft">3 events, 9 copies, wrong order, 1 failure. A new test account each time.</p>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-coral">{error}</p>}

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <ol className="panel min-h-[320px] divide-y divide-line overflow-hidden text-[12.5px]" aria-live="polite">
          {steps.length === 0 && <li className="px-4 py-6 text-soft">The copies appear here as they arrive.</li>}
          {steps.map((step) => (
            <li key={step.n} className="rise grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 px-4 py-3">
              <span className="text-faint">{step.n}</span>
              <div className="min-w-0">
                <p className="text-ink/90">{step.label}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className={step.outcome === "duplicate" ? "text-sun" : "text-moss"}>{step.outcome}</span>
                  <span className="text-faint">{short(step.type)}</span>
                </p>
                <p className={`mt-1 [overflow-wrap:anywhere] ${step.effect.startsWith("Failed") ? "text-coral" : "text-soft"}`}>{step.effect}</p>
              </div>
            </li>
          ))}
        </ol>

        <aside className="panel h-fit p-5">
          <p className="label">The test account</p>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-xs text-soft">Plan</dt>
              <dd className="serif mt-1 text-[2rem] capitalize">{current?.plan ?? "free"}</dd>
            </div>
            <div>
              <dt className="text-xs text-soft">Bottles this month</dt>
              <dd className="serif mt-1 text-[2rem]">{current?.balance ?? 10}</dd>
            </div>
          </dl>
          {done && result && (
            <p className="rise mt-5 border-t border-line pt-4 text-xs leading-relaxed text-soft">
              {result.final.copies} copies arrived. {result.final.events} events were stored and {result.final.duplicates} copies were dropped. The
              account is on <span className="text-ink">{result.final.plan}</span> with <span className="text-ink">{result.final.balance}</span>{" "}
              bottles. The allowance was granted once.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
