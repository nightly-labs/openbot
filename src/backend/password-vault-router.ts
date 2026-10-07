import { Effect } from "effect";
import type { PasswordVault } from "./password-vault";

/** Prefixes only new sources. Existing 1Password item ids keep their meaning. */
export function passwordVaultRouter(onePassword: PasswordVault, bitwarden: PasswordVault): PasswordVault {
  const prefix = "bitwarden:";
  return {
    connected: () => onePassword.connected() || bitwarden.connected(),
    loginsFor: Effect.fn("PasswordVaultRouter.loginsFor")(function* (origin: string) {
      const first = yield* onePassword.loginsFor(origin);
      const second = yield* bitwarden.loginsFor(origin);
      if (first === null && second === null) return null;
      return [...(first ?? []), ...(second ?? []).map((login) => ({ ...login, id: `${prefix}${login.id}` }))];
    }),
    secretFor: Effect.fn("PasswordVaultRouter.secretFor")(function* (id, origin, kind) {
      return yield* id.startsWith(prefix)
        ? bitwarden.secretFor(id.slice(prefix.length), origin, kind)
        : onePassword.secretFor(id, origin, kind);
    }),
  };
}
