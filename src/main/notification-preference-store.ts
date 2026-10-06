import type { NotificationPreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: NotificationPreference = { desktopNotifications: true };

interface StoredNotificationPreference extends NotificationPreference {
  /** Whether OpenBot has already shown the notification that makes macOS ask for permission. */
  permissionRequested: boolean;
}

/**
 * The desktop notification switch. Main reads it for every agent event, so it is held in memory
 * after `load` rather than read from disk each time.
 *
 * Writes are chained for the reason `update-preference-store.ts` chains its own: each one renames its
 * own temporary file into place, and an earlier rename that lands last would persist the value the
 * user just changed.
 */
export class NotificationPreferenceStore {
  readonly #path: string;
  #stored: StoredNotificationPreference = { ...DEFAULT_PREFERENCE, permissionRequested: false };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): StoredNotificationPreference | null => {
          if (isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.desktopNotifications))
            return {
              desktopNotifications: parsed.desktopNotifications,
              permissionRequested: parsed.permissionRequested === true,
            };
          return null;
        }),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#stored = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): NotificationPreference {
    return { desktopNotifications: this.#stored.desktopNotifications };
  }

  permissionRequested(): boolean {
    return this.#stored.permissionRequested;
  }

  readonly set = Effect.fn("NotificationPreference.set")(function* (
    this: NotificationPreferenceStore,
    { desktopNotifications }: NotificationPreference,
  ) {
    yield* this.#write((stored) => ({ ...stored, desktopNotifications }));
    return this.get();
  });

  markPermissionRequested(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#write((stored) => ({ ...stored, permissionRequested: true }));
  }

  #write(
    change: (stored: StoredNotificationPreference) => StoredNotificationPreference,
  ): Effect.Effect<void, PreferenceFileFailure> {
    // Read state after the preceding write commits so independent fields are retained.
    return this.#writes.withPermit(Effect.uninterruptible(Effect.suspend(() => this.#replace(change(this.#stored)))));
  }

  #replace(stored: StoredNotificationPreference): Effect.Effect<void, PreferenceFileFailure> {
    return writePreferenceFile(this.#path, { version: 1, ...stored }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.#stored = stored;
        }),
      ),
    );
  }
}
