import { call, CliError } from "./api";
import { serverUrl } from "./config";

interface Delivery {
  id: string;
  attempt: number;
  subject: string | null;
  body: string;
  deliver_at: string;
}

/** A Kinde webhook for your own app that came in through `bottle relay`. */
interface RelayedEvent {
  id: string;
  attempt: number;
  webhook_id: string;
  type: string;
  copies: number;
  token: string;
  payload: Record<string, unknown>;
}

interface Item {
  id: string;
  attempt: number;
  /** The key a receiver uses to drop a repeat. */
  key: string;
  title: string;
  lines: string;
  request: { headers: Record<string, string>; body: string };
  event: Record<string, unknown>;
}

function fromBottle(bottle: Delivery): Item {
  let isJson = false;
  try {
    JSON.parse(bottle.body);
    isJson = true;
  } catch {}
  return {
    id: bottle.id,
    attempt: bottle.attempt,
    key: bottle.id,
    title: bottle.id,
    lines: `${bottle.subject ? `${bottle.subject}: ` : ""}${bottle.body}`,
    request: {
      headers: {
        "content-type": isJson ? "application/json" : "text/plain; charset=utf-8",
        "idempotency-key": bottle.id,
        "bottle-id": bottle.id,
        "bottle-attempt": String(bottle.attempt),
      },
      body: bottle.body,
    },
    event: { event: "bottle", id: bottle.id, attempt: bottle.attempt, subject: bottle.subject, body: bottle.body },
  };
}

function fromRelay(event: RelayedEvent): Item {
  const copies = event.copies > 1 ? `  Kinde sent ${event.copies} copies, this is the only delivery` : "";
  return {
    id: event.id,
    attempt: event.attempt,
    key: event.webhook_id,
    title: `${event.type}  webhook-id ${event.webhook_id}${copies}`,
    lines: JSON.stringify(event.payload.data ?? event.payload),
    // The body is the signed JWT exactly as Kinde sent it, so your handler can check it with your keys.
    request: {
      headers: {
        "content-type": "application/jwt",
        "webhook-id": event.webhook_id,
        "bottle-attempt": String(event.attempt),
        "bottle-copies": String(event.copies),
      },
      body: event.token,
    },
    event: { event: "kinde", id: event.id, attempt: event.attempt, webhook_id: event.webhook_id, type: event.type, copies: event.copies, payload: event.payload },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => new Date().toLocaleTimeString(undefined, { hour12: false });

/** POST one item to the local server. Every try of the same item carries the same key. */
async function forwardTo(url: string, item: Item): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(10_000), ...item.request });
    return { ok: response.ok, detail: `Your server answered ${response.status}.` };
  } catch (error) {
    return { ok: false, detail: `Your server did not answer: ${(error as Error).message}` };
  }
}

/**
 * Collect terminal bottles and relayed Kinde webhooks. The server gives each one out with a 30-second lease.
 * This process answers for each attempt. With no answer, the lease ends and the same bottle,
 * with the same id, is given out again: delivery is at least once, and the id makes it safe.
 */
export async function listen(options: { server?: string; forward?: string; drop: number; once: boolean; json: boolean }): Promise<number> {
  const emit = (event: Record<string, unknown>, human: string) =>
    console.log(options.json ? JSON.stringify({ at: new Date().toISOString(), ...event }) : human);

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
  });

  // Check the sign-in before the first wait, so a problem shows at once.
  await call("/api/v1/me", { server: options.server });
  emit(
    { event: "ready", server: serverUrl(options.server), forward: options.forward ?? null },
    `Listening for terminal bottles and relayed Kinde webhooks on ${serverUrl(options.server)}.${options.forward ? ` Forwarding each one to ${options.forward}.` : ""}\nPress Ctrl+C to stop.`,
  );

  const seen = new Map<string, number>();
  let dropsLeft = options.drop;
  let offline = false;

  while (!stopping) {
    let batch: { lease_seconds: number; bottles: Delivery[]; events?: RelayedEvent[] };
    try {
      batch = (await call<{ lease_seconds: number; bottles: Delivery[]; events?: RelayedEvent[] }>("/api/v1/listen", { method: "POST", server: options.server })).data;
      if (offline) emit({ event: "online" }, `${clock()}  Connected again.`);
      offline = false;
    } catch (error) {
      if (error instanceof CliError && error.code === 3) throw error;
      if (!offline) emit({ event: "offline", detail: (error as Error).message }, `${clock()}  ${(error as Error).message} Trying again.`);
      offline = true;
      await wait(5000);
      continue;
    }

    const items = [...batch.bottles.map(fromBottle), ...(batch.events ?? []).map(fromRelay)];
    for (const item of items) {
      const times = (seen.get(item.id) ?? 0) + 1;
      seen.set(item.id, times);
      const again = times > 1 ? `  same key again, attempt ${item.attempt}` : "";
      emit(
        { ...item.event, repeat: times > 1 },
        `${clock()}  ${item.title}${again}\n          ${item.lines.replace(/\n/g, "\n          ")}`,
      );

      if (dropsLeft > 0) {
        dropsLeft -= 1;
        emit(
          { event: "dropped", id: item.id, attempt: item.attempt, lease_seconds: batch.lease_seconds },
          `          Dropped with no answer. The lease ends in ${batch.lease_seconds}s, then the server gives it out again with the same key.`,
        );
        continue;
      }

      const outcome = options.forward ? await forwardTo(options.forward, item) : { ok: true, detail: "Received by bottle listen." };
      const { data } = await call<{ state: string }>(`/api/v1/listen/${encodeURIComponent(item.id)}`, {
        method: "POST",
        server: options.server,
        body: { attempt: item.attempt, ok: outcome.ok, detail: outcome.detail },
      });
      const human =
        data.state === "delivered"
          ? `          ${options.forward ? `${outcome.detail} ` : ""}Delivered.`
          : data.state === "stale"
            ? "          This answer came after the lease ended. The server ignored it."
            : data.state === "failed"
              ? `          ${outcome.detail} That was the last try. It is marked failed.`
              : `          ${outcome.detail} The server tries again later with the same key.`;
      emit({ event: "answered", id: item.id, attempt: item.attempt, ok: outcome.ok, detail: outcome.detail, state: data.state }, human);
      if (options.once && data.state === "delivered") return 0;
    }
    await wait(items.length ? 250 : 2000);
  }
  emit({ event: "stopped" }, "Stopped.");
  return 130;
}
