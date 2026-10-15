# bottle-cli

Write it now. It arrives later, once. This is the command line for [Bottle](https://github.com/sholajegede/bottle).

```bash
npx bottle-cli login
npx bottle-cli send "Call the bank" --in 2h
npx bottle-cli send "Stand-up in 5" --at 09:55 --terminal
npx bottle-cli listen
```

## Commands

| Command | Does |
| --- | --- |
| `bottle login` | Sign in with Kinde. The CLI shows a code and a link. You approve it in the browser. |
| `bottle send <message>` | Store a bottle. Say when with `--in 10m` or `--at 09:00`. Say where with `--to <email>`, `--webhook <url>` or `--terminal`. With none of these, it goes to your own email. |
| `bottle ls` | The bottles that are waiting. `--all` shows every bottle. |
| `bottle cancel <id>` | Cancel a bottle that has not gone out. |
| `bottle relay` | The address for your own Kinde app's webhooks. Set the domain with `--kinde-domain myapp.kinde.com`. |
| `bottle listen` | Receive terminal bottles and relayed Kinde webhooks. `--forward <url>` posts each one to a local server. |
| `bottle whoami` | Your account, plan and bottles left. |
| `bottle logout` | Remove the sign-in from this computer. |

## How delivery works

`bottle listen` gets each item with a 30-second lease and answers for it. If it does not answer, for example because the process stopped, the server gives the item out again with the same key. Delivery is at least once, and the key makes a repeat safe to drop:

- A bottle carries `Idempotency-Key: <bottle id>`.
- A relayed Kinde event carries `webhook-id`, the id Kinde puts on every retry of that event.

`--drop 1` leaves the first delivery without an answer, so you can watch it come again.

## For scripts and AI agents

- Every command takes `--json`. `listen --json` writes one JSON object for each event.
- `BOTTLE_TOKEN` signs in with a token instead of the saved sign-in.
- `BOTTLE_URL` or `--server` chooses the Bottle server.
- `--key <key>` on `send` makes the command safe to repeat. The same key never makes a second bottle.
- Exit codes: 0 done, 1 failed, 2 wrong usage, 3 not signed in, 130 stopped.

The sign-in is saved in `~/.config/bottle/credentials.json`, readable only by you.

## Licence

MIT
