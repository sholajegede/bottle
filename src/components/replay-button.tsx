"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReplayButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/v1/events/${id}/replay`, { method: "POST" }).catch(() => null);
    if (!response?.ok) setFailed(true);
    // The event is applied just after the response, so the list is read again a moment later.
    setTimeout(() => {
      setBusy(false);
      router.refresh();
    }, 1500);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="ml-auto text-xs text-soft underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
    >
      {busy ? "Replaying" : failed ? "Could not replay" : "Replay"}
    </button>
  );
}
