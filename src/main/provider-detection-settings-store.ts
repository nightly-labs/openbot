import {
  DEFAULT_PROVIDER_DETECTION_SETTINGS,
  isProviderDetectionSettings,
  type ProviderDetectionSettings,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const PROVIDER_DETECTION_SETTINGS_FILE = "openbot-provider-detection-v1.json";

function copy(settings: ProviderDetectionSettings): ProviderDetectionSettings {
  return {
    enabled: settings.enabled,
    addresses: [...settings.addresses],
    folders: [...settings.folders],
    hiddenIds: [...settings.hiddenIds],
  };
}

export class ProviderDetectionSettingsStore {
  readonly #path: string;
  #settings: ProviderDetectionSettings = copy(DEFAULT_PROVIDER_DETECTION_SETTINGS);
  #readOnly = false;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed) => {
          if (isDynamicRecord(parsed) && parsed.version === 1 && isProviderDetectionSettings(parsed.settings))
            return copy(parsed.settings);
          return null;
        }),
      );
      if (Result.isFailure(loaded)) {
        if (isMissingFileError(loaded.failure.cause)) return;
        if (!(loaded.failure.cause instanceof SyntaxError)) return yield* loaded.failure;
      } else if (loaded.success) {
        this.#settings = loaded.success;
        return;
      }
      this.#readOnly = true;
    });
  }

  get(): ProviderDetectionSettings {
    return copy(this.#settings);
  }

  readonly set = Effect.fn("ProviderDetectionSettings.set")(function* (
    this: ProviderDetectionSettingsStore,
    settings: ProviderDetectionSettings,
  ) {
    if (this.#readOnly)
      return yield* new PreferenceFileFailure({
        cause: new Error(sourceText("error.provider.detectionSettingsReadOnly")),
      });
    const next = copy(settings);
    return yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          yield* writePreferenceFile(this.#path, { version: 1, settings: next }, { createDirectory: true });
          this.#settings = next;
          return this.get();
        }),
      ),
    );
  }).bind(this);
}
