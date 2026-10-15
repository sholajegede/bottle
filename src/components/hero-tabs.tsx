"use client";

import { Check, Clock, Mail, Terminal, Webhook } from "lucide-react";
import { useState } from "react";

const tabs = [
  { id: "message", label: "Message", icon: Mail, color: "#ff6b62" },
  { id: "webhook", label: "Webhook", icon: Webhook, color: "#3ecf8e" },
  { id: "api", label: "API", icon: Terminal, color: "#5b8def" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function Stage({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`grid size-5 place-items-center rounded-full border text-[10px] ${
          done ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-[#0d7f90] text-[#0d7f90]" : "border-black/20 text-black/40"
        }`}
      >
        {done ? <Check size={12} strokeWidth={3} aria-hidden /> : active ? <Clock size={11} aria-hidden /> : null}
      </span>
      <span className={done || active ? "text-black/80" : "text-black/45"}>{label}</span>
    </li>
  );
}

function Window({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-[14px] border border-white/60 bg-[#f6f5f2] text-[#1d1d1d] shadow-[0_0_0_6px_rgb(255_255_255/0.14),0_24px_50px_-18px_rgb(0_0_0/0.6)]">
      <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2.5 text-xs text-black/55">
        <span className="size-2.5 rounded-full bg-black/15" />
        <span className="size-2.5 rounded-full bg-black/15" />
        <span className="size-2.5 rounded-full bg-black/15" />
        <span className="ml-2">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

const code = "overflow-x-auto rounded-[10px] bg-[#1f1f1f] p-4 text-[12.5px] leading-relaxed text-[#e9e6e1]";

export function HeroTabs() {
  const [tab, setTab] = useState<TabId>("message");
  return (
    <div>
      <div role="tablist" aria-label="What you can send" className="mx-auto grid max-w-[876px] grid-cols-3 gap-1 rounded-[9px] border border-line bg-raised p-[7px]">
        {tabs.map(({ id, label, icon: Icon, color }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex h-[42px] items-center justify-center gap-2.5 rounded-[6px] text-sm font-semibold transition-colors ${
              tab === id ? "bg-white/[0.12] text-ink" : "text-ink/80 hover:bg-white/5"
            }`}
          >
            <span className="grid size-[22px] place-items-center rounded-[6px] text-black/80" style={{ background: color }}>
              <Icon size={13} strokeWidth={2.4} aria-hidden />
            </span>
            {label}
          </button>
        ))}
      </div>

      <div className="glass grain mx-auto mt-5 max-w-[876px] px-4 py-10 sm:px-10 sm:py-14">
        {tab === "message" && (
          <Window title="New bottle">
            <p className="text-xs text-black/50">To: ada@example.com</p>
            <p className="mt-3 font-serif text-[1.35rem] leading-snug tracking-[-0.01em]">
              Happy birthday, Ada. I wrote this in October so I would not forget in March.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 text-xs">
              <span className="rounded-full bg-black/[0.06] px-3 py-1.5 text-black/70">Arrives 14 March, 09:00</span>
              <ol className="flex flex-wrap gap-4">
                <Stage label="Stored" done />
                <Stage label="Waiting" active />
                <Stage label="Delivered once" />
              </ol>
            </div>
          </Window>
        )}
        {tab === "webhook" && (
          <Window title="Webhook, arrives in 3 days">
            <pre className={code}>{`POST https://api.example.com/trial-ended
Idempotency-Key: btl_Zk4nQ2v1Xw8a
Bottle-Attempt: 1

{ "account": "acme", "action": "end_trial" }`}</pre>
            <p className="mt-4 text-xs text-black/60">
              If your server does not answer, Bottle tries again with the same key. Your server can drop a second copy.
            </p>
          </Window>
        )}
        {tab === "api" && (
          <Window title="Terminal">
            <pre className={code}>{`curl -X POST $BOTTLE/api/v1/bottles \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Idempotency-Key: freeze-2026-10-16" \\
  -d '{
    "kind": "webhook",
    "target": "https://hooks.example.com/deploys",
    "body": "{\\"text\\":\\"Deploy freeze ends\\"}",
    "deliver_at": "2026-10-16T09:00:00Z"
  }'`}</pre>
            <p className="mt-4 text-xs text-black/60">Send the same request twice. You get the same bottle and pay for one.</p>
          </Window>
        )}
      </div>
    </div>
  );
}
