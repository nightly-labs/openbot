// The password vault that the browser fills logins from. The main process implements it with the
// 1Password connection; the agent service only reads it.

import { type Effect, Schema } from "effect";
import { getDomain } from "tldts";

/**
 * Where a saved website may be filled, as 1Password's autofill behavior says:
 * - `anywhere`: every page of the same site, subdomains included.
 * - `exact`: only the same host and port.
 * - `never`: never.
 */
export type VaultAutofill = "anywhere" | "exact" | "never";

export interface VaultWebsite {
  url: string;
  autofill: VaultAutofill;
}

/** What an agent may see of a login. The password and the one-time code are never in it. */
export interface VaultLogin {
  id: string;
  title: string;
  username: string | null;
  hasOneTimePassword: boolean;
}

/** Keeps the original vault failure private; callers log it and give the agent a fixed message. */
export class PasswordVaultError extends Schema.TaggedError<PasswordVaultError>()("PasswordVaultError", {
  cause: Schema.Defect(),
}) {}

export interface PasswordVault {
  /** Whether a vault is connected now. Agents are told about the vault only while it is. */
  connected(): boolean;
  /** The logins saved for `origin`, or null while no vault is connected. */
  loginsFor(origin: string): Effect.Effect<VaultLogin[] | null, PasswordVaultError>;
  /**
   * The password or the current one-time code of `loginId`, or null when that login is not saved for
   * `origin` or has no such value. The answer goes to the browser only, never to an agent.
   */
  secretFor(
    loginId: string,
    origin: string,
    kind: "password" | "totp",
  ): Effect.Effect<string | null, PasswordVaultError>;
}

function websiteUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * Whether a login saved for `website` may be filled on the page at `origin`. Only an HTTPS page
 * matches. `anywhere` compares the registrable domain, so `github.com` also fills on
 * `gist.github.com`; a host with no registrable domain, such as an IP address, must be equal.
 */
export function websiteMatchesOrigin(website: VaultWebsite, origin: string): boolean {
  if (website.autofill === "never") return false;
  const page = websiteUrl(origin);
  const saved = websiteUrl(website.url);
  if (!page || !saved || page.protocol !== "https:") return false;
  if (website.autofill === "exact") return page.host === saved.host;
  if (page.hostname === saved.hostname) return true;
  // Private suffixes such as `github.io` count: each site under one belongs to someone else.
  const domain = getDomain(page.hostname, { allowPrivateDomains: true });
  return domain !== null && domain === getDomain(saved.hostname, { allowPrivateDomains: true });
}
