import Link from "next/link";
import type { ReactNode } from "react";

/** A full-width band with a rule above it and the two vertical rules of the page grid. */
export function Band({
  children,
  className = "",
  inner = "",
  id,
  rule = true,
}: {
  children: ReactNode;
  className?: string;
  inner?: string;
  id?: string;
  rule?: boolean;
}) {
  return (
    <section id={id} className={`${rule ? "border-t border-line" : ""} ${className}`}>
      <div className={`mx-auto w-full max-w-[1048px] border-line px-5 sm:border-x sm:px-9 ${inner}`}>{children}</div>
    </section>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid place-items-center rounded-[10px] border border-white/25 text-[#06282d]"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(145deg, #7fe9f5 0%, #19d0e8 45%, #0d7f90 100%)",
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.6), 0 2px 6px rgb(0 0 0 / 0.5)",
        }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2h4M10.5 2v4.2c0 .5-.2 1-.6 1.3A5 5 0 0 0 8 11.4V19a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3v-7.6a5 5 0 0 0-1.9-3.9c-.4-.3-.6-.8-.6-1.3V2" />
          <path d="M10.5 13h3M10.5 16h3" />
        </svg>
      </span>
      <span className="font-serif text-[1.9rem] italic leading-none tracking-[-0.03em]" style={{ fontVariationSettings: '"opsz" 72' }}>
        Bottle
      </span>
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-black/25 px-4 py-1.5 text-[0.8rem] text-ink/90">
      {children}
    </span>
  );
}

export function Eyebrow({ color, children }: { color: string; children: ReactNode }) {
  return (
    <p className="label flex items-center gap-2">
      <span aria-hidden className="inline-block size-[18px] rounded-[5px]" style={{ background: color, boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35)" }} />
      {children}
    </p>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "lg" | "sm";
  external?: boolean;
}) {
  const className = `btn btn-${variant} ${size ? `btn-${size}` : ""}`;
  if (external || href.startsWith("/api/")) {
    return (
      <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export const Dots = ({ className = "" }: { className?: string }) => <div aria-hidden className={`dots ${className}`} />;
