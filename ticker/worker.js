// A Cloudflare Worker that turns Bottle's clock once a minute.
// It calls /api/tick, which sends the bottles that are due.
const ticker = {
  async scheduled(_event, env) {
    const response = await fetch(`${env.BOTTLE_URL}/api/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.TICK_SECRET}` },
    });
    if (!response.ok) console.error(`tick answered ${response.status}`);
  },
};

export default ticker;
