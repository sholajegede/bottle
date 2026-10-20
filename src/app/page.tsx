import { CheckCircle2, Mail, Webhook } from "lucide-react";
import { Faq } from "@/components/faq";
import { HeroTabs } from "@/components/hero-tabs";
import { Frame, signInHref, SiteFooter, SiteNav } from "@/components/site-chrome";
import { Band, ButtonLink, Dots, Eyebrow, Pill } from "@/components/ui";
import { PLANS } from "@/lib/quota";
import { site } from "@/lib/site";

const steps = [
  ["Write it", "Write a message to a person, or a request to a server."],
  ["Set the time", "Choose a minute, a day or a year from now."],
  ["Forget it", "Bottle stores it and sends it at that time, once."],
];

const features: Array<{ title: string; text: string; span?: string; extra?: React.ReactNode }> = [
  {
    title: "Stored before it is confirmed",
    text: "Bottle writes your bottle to the database first and answers second. If you got an answer, the bottle is safe.",
  },
  {
    title: "Copies are dropped",
    text: "Send the same request twice with one idempotency key. You get one bottle and you pay for one.",
  },
  {
    title: "Your count cannot go below zero",
    text: "Two requests that reach the server at the same moment cannot both take your last bottle.",
  },
  {
    title: "Retries keep the same id",
    text: "If a send fails, Bottle tries again after 30 seconds, 2 minutes, 10 minutes, 1 hour and 4 hours. Each try carries the same id.",
    span: "sm:col-span-2",
    extra: (
      <ol className="mt-5 flex flex-wrap gap-2 text-xs">
        {["30 s", "2 min", "10 min", "1 h", "4 h"].map((wait, index) => (
          <li key={wait} className="rounded-[8px] border border-line bg-black/20 px-3 py-1.5 text-soft">
            <span className="text-ink">Try {index + 2}</span> after {wait}
          </li>
        ))}
      </ol>
    ),
  },
  {
    title: "Open source",
    text: "Read the code, run it yourself, and check every claim on this page.",
  },
  {
    title: "Billing events get the same care",
    text: "Plan changes and payments from Kinde pass through the same intake. A payment that arrives five times counts once.",
    span: "sm:col-span-3",
  },
];

export default function Home() {
  return (
    <Frame>
      <SiteNav />

      <Band rule={false} inner="py-3.5 text-center text-sm">
        <span className="text-ink/90">New: watch a billing event arrive nine times and count once.</span>{" "}
        <a href="/engine-room" className="ml-2 whitespace-nowrap text-glass hover:underline">
          Open the Engine Room →
        </a>
      </Band>

      <Band inner="hero grain !px-5 py-16 text-center sm:py-24">
        <svg aria-hidden viewBox="0 0 80 200" className="drift pointer-events-none absolute bottom-6 left-[9%] hidden h-[210px] opacity-[0.22] blur-[1.5px] md:block" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 6h20M32 6v38c0 5-3 9-7 13-9 8-13 18-13 30v84c0 12 8 20 20 20h16c12 0 20-8 20-20V87c0-12-4-22-13-30-4-4-7-8-7-13V6" />
          <path d="M26 104h28M26 122h28M26 140h18" />
        </svg>
        <div className="relative">
          <Pill>Free for {PLANS.free.monthly} bottles a month</Pill>
          <h1 className="serif mx-auto mt-6 text-[clamp(2.9rem,8.5vw,5rem)]">
            Write it now.
            <br />
            It arrives later.
          </h1>
          <p className="mx-auto mt-7 max-w-[470px] text-[1.02rem] leading-[1.65] text-ink/85">
            Bottle holds a message or a webhook and delivers it at the time you set. Once, not twice, and not never.
          </p>
          <div className="mt-9">
            <ButtonLink href={signInHref()} size="lg">
              Send a bottle
            </ButtonLink>
          </div>
          <p className="mt-5 text-xs text-soft">
            No card needed. <a href={site.repo} className="underline decoration-white/30 underline-offset-4 hover:text-ink">Open source on GitHub</a>
          </p>
        </div>
      </Band>

      <Band inner="py-7">
        <HeroTabs />
      </Band>

      <Band id="how" inner="py-20 sm:py-28">
        <div className="mx-auto max-w-[640px] text-[1.3rem] leading-[1.6] tracking-[-0.02em] sm:text-[1.5rem]">
          <p>A reminder waits in an app until you open it. A bottle comes to you.</p>
          <p className="mt-7 text-soft">
            Write a{" "}
            <span className="tag text-coral">
              <Mail size={18} aria-hidden /> message
            </span>{" "}
            to a person: a birthday note, a nudge, a letter to yourself next year. Or write a{" "}
            <span className="tag text-moss">
              <Webhook size={18} aria-hidden /> webhook
            </span>{" "}
            to a server: end a trial in 14 days, lift a deploy freeze on Friday.
          </p>
          <p className="mt-7 text-soft">
            Then close the tab. Bottle delivers it at the time you set, <span className="text-ink">once</span>.
          </p>
        </div>
        <ol className="mx-auto mt-14 grid max-w-[820px] gap-3 sm:grid-cols-3">
          {steps.map(([title, text], index) => (
            <li key={title} className="panel p-5">
              <p className="label">Step {index + 1}</p>
              <h3 className="serif mt-3 text-[1.45rem]">{title}</h3>
              <p className="mt-2 text-sm text-soft">{text}</p>
            </li>
          ))}
        </ol>
      </Band>

      <Band id="features" inner="py-16 sm:py-20">
        <div className="grid gap-6 sm:grid-cols-2 sm:items-end">
          <div>
            <Eyebrow color="#19d0e8">Delivery</Eyebrow>
            <h2 className="serif mt-4 text-[clamp(2rem,5vw,3rem)]">
              Built so nothing
              <br />
              <span className="text-soft">arrives twice</span>
            </h2>
          </div>
          <p className="text-[0.98rem] leading-[1.7] text-soft">
            Networks drop requests, servers restart, and senders retry. Bottle is built for those cases first, so the normal case is easy.
          </p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className={`panel p-6 ${feature.span ?? ""}`}>
              <h3 className="serif text-[1.35rem]">{feature.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-soft">{feature.text}</p>
              {feature.extra}
            </article>
          ))}
        </div>
      </Band>

      <Band inner="py-16 sm:py-20">
        <div className="grid items-center gap-8 sm:grid-cols-[1.1fr_1fr]">
          <div>
            <Eyebrow color="#f5b94a">Engine Room</Eyebrow>
            <h2 className="serif mt-4 text-[clamp(2rem,5vw,3rem)]">See it work, live</h2>
            <p className="mt-4 max-w-[440px] text-[0.98rem] leading-[1.7] text-soft">
              Run the storm. A test account gets one plan change and one payment, sent nine times, in the wrong order, with a failure in the
              middle. Then read what the account looks like at the end.
            </p>
            <div className="mt-7">
              <ButtonLink href="/engine-room" variant="secondary">
                Open the Engine Room
              </ButtonLink>
            </div>
          </div>
          <div className="panel overflow-hidden p-0 text-[12.5px]">
            {[
              ["accepted", "customer.payment_succeeded", "payment recorded"],
              ["duplicate", "customer.payment_succeeded", "dropped"],
              ["duplicate", "customer.payment_succeeded", "dropped"],
              ["accepted", "customer.plan_changed", "plan set to pro"],
              ["accepted", "customer.agreement_cancelled", "ignored, older"],
            ].map(([outcome, type, effect], index) => (
              <div key={index} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <span className={`w-[74px] shrink-0 ${outcome === "duplicate" ? "text-sun" : "text-moss"}`}>{outcome}</span>
                <span className="min-w-0 flex-1 truncate text-ink/85">{type}</span>
                <span className="hidden shrink-0 text-soft sm:block">{effect}</span>
              </div>
            ))}
          </div>
        </div>
      </Band>

      <Band id="pricing" inner="py-16 sm:py-20">
        <div className="text-center">
          <h2 className="serif text-[clamp(2rem,5vw,3rem)]">Pricing</h2>
          <p className="mt-3 text-sm text-soft">Start free. Move to Pro when you send more.</p>
        </div>
        <div className="mx-auto mt-10 grid max-w-[720px] gap-3 sm:grid-cols-2">
          <div className="panel p-6">
            <p className="label">Free</p>
            <p className="serif mt-3 text-[2.6rem]">$0</p>
            <ul className="mt-5 space-y-2.5 text-sm text-ink/85">
              {[`${PLANS.free.monthly} bottles a month`, "Messages and webhooks", "Retries and delivery log", "API access"].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-soft" aria-hidden /> {item}
                </li>
              ))}
            </ul>
            <div className="mt-7">
              <ButtonLink href={signInHref()} variant="secondary">
                Start free
              </ButtonLink>
            </div>
          </div>
          <div className="glass grain p-6">
            <div className="relative z-10">
              <p className="label !text-white/80">Pro</p>
              <p className="serif mt-3 text-[2.6rem]">
                $9 <span className="font-mono text-sm font-normal tracking-normal text-white/75">a month</span>
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {[`${PLANS.pro.monthly} bottles a month`, "Everything in Free", "Billing handled by Kinde", "Cancel at any time"].map((item) => (
                  <li key={item} className="flex items-center gap-2.5">
                    <CheckCircle2 size={16} className="text-[#d6ff7a]" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <ButtonLink href={signInHref()}>Get Pro</ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </Band>

      <Band id="faq" inner="py-16 sm:py-20">
        <h2 className="serif text-center text-[clamp(2rem,5vw,3rem)]">Questions</h2>
        <div className="mt-10">
          <Faq />
        </div>
      </Band>

      <Band inner="hero grain !px-5 py-20 text-center">
        <div className="relative">
          <Dots className="mx-auto mb-8 w-28" />
          <h2 className="serif mx-auto max-w-[16ch] text-[clamp(2.2rem,6vw,3.4rem)]">Say it now. Let it arrive on time.</h2>
          <p className="mx-auto mt-5 max-w-[400px] text-[0.98rem] text-ink/80">Your first {PLANS.free.monthly} bottles each month are free.</p>
          <div className="mt-8">
            <ButtonLink href={signInHref()} size="lg">
              Send a bottle
            </ButtonLink>
          </div>
        </div>
      </Band>

      <SiteFooter />
    </Frame>
  );
}
