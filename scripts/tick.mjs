// Calls the local tick endpoint every 15 seconds while `npm run dev` runs.
const url = `http://localhost:${process.env.PORT ?? 3000}/api/tick`;
const headers = process.env.TICK_SECRET ? { authorization: `Bearer ${process.env.TICK_SECRET}` } : {};

setInterval(async () => {
  try {
    await fetch(url, { method: "POST", headers });
  } catch {
    // The web server is not up yet. Try again on the next turn.
  }
}, 15_000);
