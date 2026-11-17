import { readFileSync } from "node:fs";
import type { HostTimezoneSettings } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { localTimezone } from "../backend/agent/routine-tools";
import { isMissingFileError } from "../backend/file-errors";
import { validTimezone } from "./agent-marketplace-service";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const SERVER_TIMEZONE_PREFERENCE_FILE = "openbot-server-timezone-v1.json";

/**
 * The server timezone. A routine that an agent creates with no zone from the tool call or the
 * sender's message runs on it, so a server on a UTC computer can keep its members' clock across a
 * restart. `null` is automatic: the system zone of this computer, which every such routine used
 * before the setting existed.
 *
 * A file that is missing, unreadable as JSON, or names a zone this runtime cannot resolve reads as
 * automatic. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class ServerTimezonePreferenceStore {
  readonly #path: string;
  readonly #systemTimezone: () => string;
  #timezone: string | null = null;
  #writes = Semaphore.makeUnsafe(1);

  /** `systemTimezone` is the zone of this computer, also when `applyServerTimezone` changed `TZ`. */
  constructor(path: string, systemTimezone: () => string) {
    this.#path = path;
    this.#systemTimezone = systemTimezone;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeServerTimezone));
      if (Result.isSuccess(loaded)) this.#timezone = loaded.success;
      else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): HostTimezoneSettings {
    return { timezone: this.#timezone, systemTimezone: this.#systemTimezone() };
  }

  /** The zone that applies now: the chosen one, or the system zone. */
  effective(): string {
    return this.#timezone ?? this.#systemTimezone();
  }

  /** The caller reads the zone with `parseServerTimezone` first. */
  readonly set = Effect.fn("ServerTimezonePreference.set")((timezone: string | null) =>
    this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, timezone }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#timezone = timezone;
            }),
          ),
          Effect.map(() => this.get()),
        ),
      ),
    ),
  );
}

/** A zone this runtime resolves, or `null` for automatic. */
export function parseServerTimezone(value: unknown): string | null {
  if (value === null) return null;
  if (!isString(value) || value.length > 128 || !validTimezone(value))
    throw new Error(sourceText("error.host.timezoneInvalid"));
  return value;
}

/** The `TZ` from before `applyServerTimezone` changed it: `=` and the value, or `unset`. */
const SYSTEM_TZ = "OPENBOT_SYSTEM_TZ";

function decodeServerTimezone(parsed: unknown): string | null {
  return isDynamicRecord(parsed) && parsed.version === 1 && isString(parsed.timezone) && validTimezone(parsed.timezone)
    ? parsed.timezone
    : null;
}

/**
 * On a server, sets `TZ` to the chosen zone before the app is ready. Chromium reads the zone of its
 * pages only when a renderer starts, so the agent browser shows the zone of the server only with
 * `TZ` (#8935). A change applies at the next start. Returns the zone of this computer from before.
 * A file that `load` reads as automatic leaves `TZ` as it is.
 */
export function applyServerTimezone(path: string, environment: NodeJS.ProcessEnv): () => string {
  // A relaunch (`relaunchApp`) gives the new process the environment of this one, with the chosen
  // `TZ`. Put back the `TZ` of the computer first, so "Automatic" shows its zone and applies again.
  const before = environment[SYSTEM_TZ];
  if (before !== undefined) {
    if (before.startsWith("=")) environment.TZ = before.slice(1);
    else delete environment.TZ;
    delete environment[SYSTEM_TZ];
  }
  const systemTimezone = localTimezone();
  let chosen: string | null = null;
  try {
    chosen = decodeServerTimezone(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // A missing or damaged file is automatic. `load` reports a read failure that is not expected.
  }
  if (chosen === null || chosen === systemTimezone) return localTimezone;
  environment[SYSTEM_TZ] = environment.TZ === undefined ? "unset" : `=${environment.TZ}`;
  environment.TZ = chosen;
  return () => systemTimezone;
}
