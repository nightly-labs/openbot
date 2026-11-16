// The password vault that the browser fills logins from. The main process implements it with the
// 1Password connection; the agent service only reads it.

import type { PasswordManagerId } from "@openbot/contracts/ipc";
import { type Effect, Schema } from "effect";
import { getDomain } from "tldts";

/**
 * The brand name of each password manager that main connects, in `PASSWORD_MANAGER_IDS` order. Agent
 * text names them; a brand is not translated.
 */
export const PASSWORD_MANAGER_BRANDS = {
  onepassword: "1Password",
  bitwarden: "Bitwarden",
  protonpass: "Proton Pass",
} as const satisfies Record<PasswordManagerId, string>;

export const PASSWORD_MANAGER_BRAND_NAMES: readonly string[] = Object.values(PASSWORD_MANAGER_BRANDS);

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

const vaultLoginSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  username: Schema.NullOr(Schema.String),
  hasOneTimePassword: Schema.Boolean,
});

/**
 * Keeps the original vault failure private; callers log it and give the agent a fixed message.
 * When some login sources of the router could not be read, `sources` names them and `logins` holds
 * the logins of the other sources.
 */
export class PasswordVaultError extends Schema.TaggedError<PasswordVaultError>()("PasswordVaultError", {
  cause: Schema.Defect(),
  sources: Schema.optionalKey(Schema.Array(Schema.String)),
  logins: Schema.optionalKey(Schema.Array(vaultLoginSchema)),
}) {}

export interface PasswordVault {
  /** Whether a vault is connected now. Agents are told about the vault only while it is. */
  connected(): boolean;
  /**
   * The logins saved for `origin`, or null while no vault is connected. `agentId` is the agent that
   * fills: the OpenBot Vault gives it only the logins that it can use, and without it only the logins
   * for every agent. A password manager of the user has no agent scope and ignores it.
   */
  loginsFor(origin: string, agentId?: string): Effect.Effect<VaultLogin[] | null, PasswordVaultError>;
  /**
   * The password or the current one-time code of `loginId`, or null when that login is not saved for
   * `origin` or has no such value. The answer goes to the browser only, never to an agent.
   */
  secretFor(
    loginId: string,
    origin: string,
    kind: "password" | "totp",
    agentId?: string,
  ): Effect.Effect<string | null, PasswordVaultError>;
}

/** A saved website as a URL. A website with no `scheme://` is HTTPS, and `host:port` is a host. */
export function websiteUrl(value: string): URL | null {
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
