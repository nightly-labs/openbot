import type { PasswordManagerId } from "@openbot/contracts/ipc";
import { type Effect, Schema } from "effect";
import { getDomain } from "tldts";

export const PASSWORD_MANAGER_BRANDS = {
  onepassword: "1Password",
  bitwarden: "Bitwarden",
  protonpass: "Proton Pass",
} as const satisfies Record<PasswordManagerId, string>;

export const PASSWORD_MANAGER_BRAND_NAMES: readonly string[] = Object.values(PASSWORD_MANAGER_BRANDS);

export type VaultAutofill = "anywhere" | "exact" | "never";

export interface VaultWebsite {
  url: string;
  autofill: VaultAutofill;
}

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

export class PasswordVaultError extends Schema.TaggedError<PasswordVaultError>()("PasswordVaultError", {
  cause: Schema.Defect(),
  sources: Schema.optionalKey(Schema.Array(Schema.String)),
  logins: Schema.optionalKey(Schema.Array(vaultLoginSchema)),
}) {}

export interface PasswordVault {
  connected(): boolean;
  loginsFor(origin: string, agentId?: string): Effect.Effect<VaultLogin[] | null, PasswordVaultError>;
  secretFor(
    loginId: string,
    origin: string,
    kind: "password" | "totp",
    agentId?: string,
  ): Effect.Effect<string | null, PasswordVaultError>;
}

export function websiteUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

export function websiteMatchesOrigin(website: VaultWebsite, origin: string): boolean {
  if (website.autofill === "never") return false;
  const page = websiteUrl(origin);
  const saved = websiteUrl(website.url);
  if (!page || !saved || page.protocol !== "https:") return false;
  if (website.autofill === "exact") return page.host === saved.host;
  if (page.hostname === saved.hostname) return true;
  const domain = getDomain(page.hostname, { allowPrivateDomains: true });
  return domain !== null && domain === getDomain(saved.hostname, { allowPrivateDomains: true });
}
