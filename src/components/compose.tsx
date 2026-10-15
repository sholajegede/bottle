"use client";

import { Mail, SquareTerminal, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const localValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const quick: Array<[string, () => Date]> = [
  ["In 10 minutes", () => new Date(Date.now() + 10 * 60_000)],
  ["In 1 hour", () => new Date(Date.now() + 60 * 60_000)],
  ["Tomorrow, 09:00", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
  ["In 1 week", () => new Date(Date.now() + 7 * 24 * 60 * 60_000)],
  ["In 1 year", () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d; }],
];

type Kind = "email" | "webhook" | "terminal";

export function Compose({ email, left }: { email: string | null; left: number }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("email");
  const [target, setTarget] = useState(email ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(() => localValue(new Date(Date.now() + 60 * 60_000)));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // One key for each draft. A second click or a retry sends the same key, so it cannot make a second bottle.
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());

  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  function switchKind(next: Kind) {
    setKind(next);
    setTarget(next === "email" ? (email ?? "") : "");
    setNotice(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/bottles", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": draftKey },
        body: JSON.stringify({ kind, target: kind === "terminal" ? "terminal" : target, subject: kind === "email" ? subject : undefined, body, deliver_at: new Date(when).toISOString() }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice({ ok: false, text: result.error ?? "Bottle could not store this. Try again." });
        return;
      }
      setNotice({ ok: true, text: `Stored. It goes out ${new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.` });
      setBody("");
      setSubject("");
      setDraftKey(crypto.randomUUID());
      router.refresh();
    } catch {
      setNotice({ ok: false, text: "The server did not answer. Your draft is still here. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel p-5 sm:p-6">
      <div role="tablist" aria-label="Kind of bottle" className="grid grid-cols-3 gap-1 rounded-[9px] border border-line bg-raised p-1.5">
        {(
          [
            ["email", "Message", Mail, "#ff6b62"],
            ["webhook", "Webhook", Webhook, "#3ecf8e"],
            ["terminal", "Terminal", SquareTerminal, "#f5b94a"],
          ] as const
        ).map(([id, label, Icon, color]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            onClick={() => switchKind(id)}
            className={`flex h-10 items-center justify-center gap-2 rounded-[6px] text-sm font-semibold ${kind === id ? "bg-white/[0.12]" : "text-ink/75 hover:bg-white/5"}`}
          >
            <span className="grid size-5 place-items-center rounded-[5px] text-black/80" style={{ background: color }}>
              <Icon size={12} strokeWidth={2.4} aria-hidden />
            </span>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {kind === "terminal" ? (
          <p className="rounded-[9px] border border-line bg-raised p-3.5 text-sm text-soft">
            This bottle goes to your terminal. Run <code className="text-ink">npx bottle-cli listen</code> on any computer where you are signed in.
          </p>
        ) : (
        <div>
          <label htmlFor="target" className="label">
            {kind === "email" ? "To" : "Address"}
          </label>
          <input
            id="target"
            className="field mt-1.5"
            type={kind === "email" ? "email" : "url"}
            required
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={kind === "email" ? "name@example.com" : "https://api.example.com/hook"}
          />
        </div>
        )}
        {kind === "email" && (
          <div>
            <label htmlFor="subject" className="label">
              Subject
            </label>
            <input id="subject" className="field mt-1.5" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} placeholder="A bottle for you" />
          </div>
        )}
        <div>
          <label htmlFor="body" className="label">
            {kind === "webhook" ? "Body" : "Message"}
          </label>
          <textarea
            id="body"
            className="field mt-1.5 min-h-[130px] resize-y"
            required
            value={body}
            maxLength={20000}
            onChange={(event) => setBody(event.target.value)}
            placeholder={kind === "webhook" ? '{ "text": "Deploy freeze ends" }' : "Write the message."}
          />
        </div>
        <div>
          <label htmlFor="when" className="label">
            Deliver at
          </label>
          <input id="when" className="field mt-1.5" type="datetime-local" required value={when} onChange={(event) => setWhen(event.target.value)} />
          <p className="mt-1.5 text-xs text-faint">Your time zone: {zone}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {quick.map(([label, make]) => (
              <button key={label} type="button" onClick={() => setWhen(localValue(make()))} className="rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-white/30 hover:text-ink">
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-soft">
          {left} {left === 1 ? "bottle" : "bottles"} left this month
        </p>
        <button className="btn btn-primary" disabled={busy || left < 1}>
          {busy ? "Storing" : "Send the bottle"}
        </button>
      </div>
      <p role="status" className={`mt-3 min-h-5 text-sm ${notice?.ok ? "text-moss" : "text-coral"}`}>
        {notice?.text}
      </p>
    </form>
  );
}
