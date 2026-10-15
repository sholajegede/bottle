export const site = {
  name: "Bottle",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tagline: "Write it now. It arrives later, once.",
  description:
    "Bottle holds a message or a webhook and delivers it at the time you set, exactly once. Free for 10 bottles a month, and open source.",
  repo: "https://github.com/sholajegede/bottle",
};
