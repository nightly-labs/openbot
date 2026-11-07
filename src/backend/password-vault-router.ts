import { Effect } from "effect";
import type { PasswordVault, VaultLogin } from "./password-vault";

/** One source of logins. Its ids get `prefix`; the first source keeps an empty prefix. */
export interface PasswordVaultSource {
  prefix: string;
  vault: PasswordVault;
}

/**
 * Lists the logins of every source and fills from the one that a login id names. Only new sources get
 * a prefix: existing 1Password item ids keep their meaning, and Bitwarden ids keep `bitwarden:`.
 */
export function passwordVaultRouter(sources: ReadonlyArray<PasswordVaultSource>): PasswordVault {
  // The longest prefix first, so the empty prefix matches only an id that no other source names.
  const byPrefix = [...sources].sort((a, b) => b.prefix.length - a.prefix.length);
  return {
    connected: () => sources.some(({ vault }) => vault.connected()),
    loginsFor: Effect.fn("PasswordVaultRouter.loginsFor")(function* (origin: string) {
      const found: VaultLogin[] = [];
      let any = false;
      for (const { prefix, vault } of sources) {
        const list = yield* vault.loginsFor(origin);
        if (list === null) continue;
        any = true;
        found.push(...list.map((login) => ({ ...login, id: `${prefix}${login.id}` })));
      }
      return any ? found : null;
    }),
    secretFor: Effect.fn("PasswordVaultRouter.secretFor")(function* (id, origin, kind) {
      const source = byPrefix.find(({ prefix }) => id.startsWith(prefix));
      if (!source) return null;
      return yield* source.vault.secretFor(id.slice(source.prefix.length), origin, kind);
    }),
  };
}
