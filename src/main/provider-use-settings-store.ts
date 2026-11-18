import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  MANAGED_RUNTIME_PROVIDERS,
  type ManagedProviderId,
} from "@openbot/contracts/agent-providers";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const ProviderUseFile = Schema.Struct({
  version: Schema.Literal(1),
  off: Schema.Array(Schema.Literals(AGENT_PROVIDERS.filter((provider) => provider !== "acp"))),
  /**
   * The managed CLIs that run in the user's own install, also when OpenBot's copy is newer (#6327).
   * Strings, so that a provider of a later release does not make the file unreadable after a downgrade.
   */
  installed: Schema.optional(Schema.Array(Schema.String)),
});
const decodeProviderUseFile = Schema.decodeUnknownResult(ProviderUseFile);

function isManagedProviderId(value: string): value is ManagedProviderId {
  return MANAGED_RUNTIME_PROVIDERS.some((provider) => provider === value);
}

/** Owns the local provider switches and CLI choices. Unknown files stay unchanged. */
export class ProviderUseSettingsStore {
  readonly #path: string;
  readonly #writes = Semaphore.makeUnsafe(1);
  #off: AgentProviderId[] = [];
  #installed: ManagedProviderId[] = [];
  #readOnly = false;

  constructor(path: string) {
    this.#path = path;
  }

  readonly load = Effect.fn("ProviderUseSettings.load")(function* (this: ProviderUseSettingsStore) {
    const result = yield* Effect.result(
      readPreferenceFile(this.#path, (value) => {
        const decoded = decodeProviderUseFile(value);
        return Result.isSuccess(decoded)
          ? {
              off: [...decoded.success.off],
              installed: (decoded.success.installed ?? []).filter(isManagedProviderId),
            }
          : null;
      }),
    );
    if (Result.isFailure(result)) {
      if (isMissingFileError(result.failure.cause)) return;
      if (!(result.failure.cause instanceof SyntaxError)) return yield* result.failure;
    } else if (result.success) {
      this.#off = result.success.off;
      this.#installed = result.success.installed;
      return;
    }
    this.#readOnly = true;
  }).bind(this);

  off(): readonly AgentProviderId[] {
    return [...this.#off];
  }

  installed(): readonly ManagedProviderId[] {
    return [...this.#installed];
  }

  readonly set = Effect.fn("ProviderUseSettings.set")(function* (
    this: ProviderUseSettingsStore,
    provider: AgentProviderId,
    on: boolean,
  ) {
    return yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const off = this.#off.filter((id) => id !== provider);
        if (!on) off.push(provider);
        yield* this.#write(off, this.#installed);
        this.#off = off;
      }).pipe(Effect.uninterruptible),
    );
  }).bind(this);

  readonly setInstalled = Effect.fn("ProviderUseSettings.setInstalled")(function* (
    this: ProviderUseSettingsStore,
    provider: ManagedProviderId,
    chosen: boolean,
  ) {
    return yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const installed = this.#installed.filter((id) => id !== provider);
        if (chosen) installed.push(provider);
        yield* this.#write(this.#off, installed);
        this.#installed = installed;
      }).pipe(Effect.uninterruptible),
    );
  }).bind(this);

  #write(off: readonly AgentProviderId[], installed: readonly ManagedProviderId[]) {
    if (this.#readOnly)
      return Effect.fail(
        new PreferenceFileFailure({ cause: new Error(sourceText("error.provider.useSettingsReadOnly")) }),
      );
    // Without a choice the file stays as earlier releases wrote it.
    const file = installed.length > 0 ? { version: 1, off, installed } : { version: 1, off };
    return writePreferenceFile(this.#path, file, { createDirectory: true });
  }
}
