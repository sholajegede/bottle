import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True for addresses that are not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

const allowLocal = () => process.env.NODE_ENV !== "production" || process.env.BOTTLE_ALLOW_LOCAL_TARGETS === "1";

/** Check the form of a webhook address. Returns a reason when it is not allowed. */
export function checkWebhookUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "The address is not a valid URL.";
  }
  if (url.username || url.password) return "The address must not contain a user name or password.";
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && allowLocal()) return undefined;
  return "The address must start with https://.";
}

/** Before a send, make sure the host does not point into a private network. */
export async function assertPublicHost(raw: string): Promise<void> {
  if (allowLocal()) return;
  const { hostname } = new URL(raw);
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("The address points to a private network.");
  }
}
