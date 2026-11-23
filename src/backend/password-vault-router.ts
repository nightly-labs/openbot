import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result } from "effect";
import { type PasswordVault, PasswordVaultError, type VaultLogin } from "./password-vault";

const logger = createOpenBotLogger("password-vault");

export interface PasswordVaultSource {
  prefix: string;
  name: string;
  vault: PasswordVault;
}

export function passwordVaultRouter(sources: ReadonlyArray<PasswordVaultSource>): PasswordVault {
  const byPrefix = [...sources].sort((a, b) => b.prefix.length - a.prefix.length);
  return {
    connected: () => sources.some(({ vault }) => vault.connected()),
    loginsFor: Effect.fn("PasswordVaultRouter.loginsFor")(function* (origin: string, agentId?: string) {
      const found: VaultLogin[] = [];
      const unreadable: string[] = [];
      let any = false;
      for (const { prefix, name, vault } of sources) {
        const list = yield* Effect.result(vault.loginsFor(origin, agentId));
        if (Result.isFailure(list)) {
          logger.warn("Unable to list the logins of a password source", {
            source: name,
            error: toLogValue(list.failure.cause),
          });
          unreadable.push(name);
          continue;
        }
        if (list.success === null) continue;
        any = true;
        found.push(...list.success.map((login) => ({ ...login, id: `${prefix}${login.id}` })));
      }
      if (unreadable.length > 0)
        return yield* new PasswordVaultError({
          cause: new Error(`Unreadable password sources: ${unreadable.join(", ")}.`),
          sources: unreadable,
          logins: found,
        });
      return any ? found : null;
    }),
    secretFor: Effect.fn("PasswordVaultRouter.secretFor")(function* (id, origin, kind, agentId) {
      const source = byPrefix.find(({ prefix }) => id.startsWith(prefix));
      if (!source) return null;
      return yield* source.vault.secretFor(id.slice(source.prefix.length), origin, kind, agentId);
    }),
  };
}
