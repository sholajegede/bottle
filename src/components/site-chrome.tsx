import Link from "next/link";
import { kindeReady } from "@/lib/kinde";
import { site } from "@/lib/site";
import { ButtonLink, Dots, Logo } from "./ui";

/** Where "Sign in" goes. Without Kinde settings the local account opens the app directly. */
export const signInHref = () => (kindeReady() ? "/api/auth/login?post_login_redirect_url=/app" : "/app");

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/engine-room", label: "Engine Room" },
  { href: "/#pricing", label: "Pricing" },
];

export function SiteNav({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-frame/85 backdrop-blur-md sm:rounded-t-[24px]">
      <div className="mx-auto flex h-[76px] w-full max-w-[1048px] items-center justify-between gap-4 border-line px-5 sm:border-x sm:px-9">
        <Link href="/" aria-label="Bottle home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm text-ink/80 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-ink">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          {signedIn ? (
            <ButtonLink href="/app">Open Bottle</ButtonLink>
          ) : (
            <>
              <span className="hidden sm:block">
                <ButtonLink href={signInHref()} variant="secondary">
                  Sign in
                </ButtonLink>
              </span>
              <ButtonLink href={signInHref()}>Send a bottle</ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const columns = [
  { title: "Product", items: [["Send a bottle", "/app"], ["How it works", "/#how"], ["Pricing", "/#pricing"]] },
  { title: "Developers", items: [["Engine Room", "/engine-room"], ["API", "/#api"], ["Source code", site.repo]] },
  { title: "Questions", items: [["FAQ", "/#faq"], ["Report a problem", `${site.repo}/issues`]] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line px-5 pb-8 pt-10 sm:px-9">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <Logo />
        <div className="grid flex-1 grid-cols-2 gap-8 sm:max-w-[640px] sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <p className="label !text-ink">{column.title}</p>
              <ul className="mt-3 space-y-2 text-sm text-soft">
                {column.items.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="hover:text-ink">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-6">
        <Dots className="hidden w-32 sm:block" />
        <p className="text-xs text-faint">Bottle is free and open source. MIT licence.</p>
        <Dots className="hidden w-32 sm:block" />
      </div>
    </footer>
  );
}

/** The rounded frame that holds every page. */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen sm:p-4">
      <div className="mx-auto max-w-[1720px] border-line bg-frame sm:rounded-[24px] sm:border">{children}</div>
    </div>
  );
}
