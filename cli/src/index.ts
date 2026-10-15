import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { call, CliError } from "./api";
import { configPath, forget, serverUrl } from "./config";
import { listen } from "./listen";
import { login } from "./login";
import { fromNow, parseAt, parseIn } from "./time";

declare const BOTTLE_VERSION: string;

const HELP = `bottle ${BOTTLE_VERSION}. Write it now. It arrives later, once.

Usage
  bottle login                    Sign in with Kinde (a code in your browser)
  bottle send <message> --in 10m  Store a bottle
  bottle ls                       List your bottles
  bottle cancel <id>              Cancel a bottle that has not gone out
  bottle listen                   Receive terminal bottles and relayed Kinde webhooks here
  bottle relay                    Show the address for your own Kinde app's webhooks
  bottle whoami                   Show your account and bottles left
  bottle logout                   Remove the sign-in from this computer

Send
  --in <time>        90s, 10m, 2h, 3d, 1w or 1h30m from now
  --at <time>        2026-10-16T09:00, or 09:00 for the next 09:00
  --to <email>       Email it to this address (default: your own address)
  --webhook <url>    POST it to this address
  --terminal         Give it to \`bottle listen\`
  --subject <text>   The subject of an email
  --key <key>        Idempotency key. The same key never makes a second bottle.

Relay
  --kinde-domain <d> The Kinde domain whose signatures the relay accepts, for example myapp.kinde.com

Listen
  --forward <url>    POST each item to a local server, with the same key on every try
  --drop <n>         Do not answer the first n deliveries, to see the lease end and the bottle come again
  --once             Stop after the first bottle

Everywhere
  --json             One JSON object for each result (listen writes one for each event)
  --server <url>     The Bottle server (or BOTTLE_URL)

Exit codes: 0 done, 1 failed, 2 wrong usage, 3 not signed in, 130 stopped.`;

const options = {
  in: { type: "string" },
  at: { type: "string" },
  to: { type: "string" },
  webhook: { type: "string" },
  terminal: { type: "boolean" },
  subject: { type: "string" },
  key: { type: "string" },
  forward: { type: "string" },
  "kinde-domain": { type: "string" },
  drop: { type: "string" },
  once: { type: "boolean" },
  all: { type: "boolean" },
  json: { type: "boolean" },
  server: { type: "string" },
  "no-browser": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

interface BottleView {
  id: string;
  kind: "email" | "webhook" | "terminal";
  target: string;
  subject: string | null;
  body: string;
  deliver_at: string;
  status: string;
  attempts: number;
  last_error: string | null;
}

interface Relay {
  url: string;
  kinde_domain: string | null;
  waiting: number;
  delivered: number;
  copies_received: number;
}

const usage = (message: string) => new CliError(`${message}\nRun: bottle --help`, 2);
const where = (b: BottleView) => (b.kind === "terminal" ? "your terminal" : b.target);
const short = (text: string, n = 60) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usage(error instanceof Error ? error.message : String(error));
  }
  const { values: flag, positionals } = parsed;
  const [command, ...rest] = positionals;
  const json = Boolean(flag.json);
  const out = (human: string, data?: unknown) => console.log(json ? JSON.stringify(data ?? { message: human }) : human);
  const say = (line: string) => (json ? console.error(line) : console.log(line));

  if (flag.version) return (console.log(BOTTLE_VERSION), 0);
  if (flag.help || !command || command === "help") return (console.log(HELP), 0);

  switch (command) {
    case "login": {
      const result = await login({ server: flag.server, browser: !flag["no-browser"], say });
      const me = await call<{ email: string | null; left: number }>("/api/v1/me", { server: flag.server });
      out(
        result.mode === "local"
          ? `Signed in to the local server at ${result.server} as the local account.`
          : `Signed in as ${me.data.email ?? "your Kinde account"}. ${me.data.left} bottles left this month.`,
        { signed_in: true, server: result.server, mode: result.mode, email: me.data.email, left: me.data.left },
      );
      return 0;
    }

    case "logout": {
      const removed = forget();
      out(removed ? "Signed out. The sign-in is removed from this computer." : "You were not signed in.", { signed_out: removed });
      return 0;
    }

    case "whoami": {
      const { data } = await call<{ id: string; email: string | null; plan_name: string; billing_state: string; left: number }>(
        "/api/v1/me",
        { server: flag.server },
      );
      out(
        `${data.email ?? data.id} on ${data.plan_name}. ${data.left} bottles left this month.${data.billing_state === "past_due" ? " A payment is past due." : ""}\nServer: ${serverUrl(flag.server)}\nSign-in: ${configPath()}`,
        { ...data, server: serverUrl(flag.server) },
      );
      return 0;
    }

    case "send": {
      const body = rest.join(" ").trim();
      if (!body) throw usage("Write the message, for example: bottle send \"Call the bank\" --in 2h");
      if (flag.in && flag.at) throw usage("Use --in or --at, not both.");
      if (!flag.in && !flag.at) throw usage("Say when it goes out, with --in 10m or --at 09:00.");
      const targets = [flag.to, flag.webhook, flag.terminal].filter(Boolean).length;
      if (targets > 1) throw usage("Choose one of --to, --webhook and --terminal.");
      let deliverAt: Date;
      try {
        deliverAt = flag.in ? parseIn(flag.in) : parseAt(flag.at!);
      } catch (error) {
        throw usage((error as Error).message);
      }
      const kind = flag.webhook ? "webhook" : flag.terminal ? "terminal" : "email";
      // A key for this send. A retry of the same command with --key cannot make a second bottle.
      const key = flag.key ?? `cli-${randomUUID()}`;
      const { data } = await call<{ bottle: BottleView; created: boolean }>("/api/v1/bottles", {
        method: "POST",
        server: flag.server,
        headers: { "idempotency-key": key },
        body: { kind, target: flag.webhook ?? flag.to, subject: flag.subject, body, deliver_at: deliverAt.toISOString() },
      });
      const when = new Date(data.bottle.deliver_at);
      out(
        data.created
          ? `Stored ${data.bottle.id}. It goes to ${where(data.bottle)} ${fromNow(when)} (${when.toLocaleString()}).${kind === "terminal" ? "\nRun `bottle listen` to receive it." : ""}`
          : `Already stored as ${data.bottle.id} with this key. Nothing new was made.`,
        { ...data, idempotency_key: key },
      );
      return 0;
    }

    case "ls":
    case "list": {
      const { data } = await call<{ bottles: BottleView[] }>("/api/v1/bottles", { server: flag.server });
      const bottles = flag.all ? data.bottles : data.bottles.filter((b) => b.status === "scheduled" || b.status === "sending");
      if (json) return (console.log(JSON.stringify({ bottles })), 0);
      if (bottles.length === 0) {
        console.log(flag.all ? "No bottles yet." : "Nothing is waiting. Use --all to see delivered bottles.");
        return 0;
      }
      for (const b of bottles) {
        const when = new Date(b.deliver_at);
        const state = b.status === "scheduled" || b.status === "sending" ? fromNow(when) : b.status;
        console.log(`${b.id}  ${state.padEnd(12)} ${where(b).padEnd(28).slice(0, 28)} ${short(b.subject ? `${b.subject}: ${b.body}` : b.body, 48)}`);
      }
      return 0;
    }

    case "cancel": {
      const id = rest[0];
      if (!id) throw usage("Give the id of the bottle, for example: bottle cancel btl_…");
      const { status, data } = await call<{ error?: string }>(`/api/v1/bottles/${encodeURIComponent(id)}`, {
        method: "DELETE",
        server: flag.server,
      });
      if (status === 409) throw new CliError(data.error ?? "This bottle has already gone out or does not exist.");
      out(`Cancelled ${id}. The bottle is given back to your allowance.`, { cancelled: true, id });
      return 0;
    }

    case "relay": {
      const { data } = flag["kinde-domain"]
        ? await call<Relay>("/api/v1/relay", { method: "POST", server: flag.server, body: { kinde_domain: flag["kinde-domain"] } })
        : await call<Relay>("/api/v1/relay", { server: flag.server });
      const steps = data.kinde_domain
        ? `Kinde domain: ${data.kinde_domain}\nIn Kinde, go to Settings > Webhooks, add a webhook with this address, and choose the events.\nThen run: bottle listen --forward http://localhost:3000/api/webhooks`
        : "Next, give the Kinde domain of your app:\n  bottle relay --kinde-domain myapp.kinde.com";
      out(
        `Your relay address:\n  ${data.url}\n${steps}\n\n${data.copies_received} copies received, ${data.delivered} delivered, ${data.waiting} waiting.`,
        data,
      );
      return 0;
    }

    case "listen": {
      const drop = flag.drop === undefined ? 0 : Number(flag.drop);
      if (!Number.isInteger(drop) || drop < 0) throw usage("--drop takes a whole number.");
      if (flag.forward) {
        try {
          new URL(flag.forward);
        } catch {
          throw usage("--forward takes a URL, for example http://localhost:4000/hook");
        }
      }
      return listen({ server: flag.server, forward: flag.forward, drop, once: Boolean(flag.once), json });
    }

    default:
      throw usage(`"${command}" is not a bottle command.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    const code = error instanceof CliError ? error.code : 1;
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes("--json")) console.log(JSON.stringify({ error: message, code }));
    else console.error(message);
    process.exit(code);
  },
);

