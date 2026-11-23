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

export class ServerTimezonePreferenceStore {
  readonly #path: string;
  readonly #systemTimezone: () => string;
  #timezone: string | null = null;
  #writes = Semaphore.makeUnsafe(1);

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

  effective(): string {
    return this.#timezone ?? this.#systemTimezone();
  }

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

export function parseServerTimezone(value: unknown): string | null {
  if (value === null) return null;
  if (!isString(value) || value.length > 128 || !validTimezone(value))
    throw new Error(sourceText("error.host.timezoneInvalid"));
  return value;
}

const SYSTEM_TZ = "OPENBOT_SYSTEM_TZ";

function decodeServerTimezone(parsed: unknown): string | null {
  return isDynamicRecord(parsed) && parsed.version === 1 && isString(parsed.timezone) && validTimezone(parsed.timezone)
    ? parsed.timezone
    : null;
}

export function applyServerTimezone(path: string, environment: NodeJS.ProcessEnv): () => string {
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
  } catch {}
  if (chosen === null || chosen === systemTimezone) return localTimezone;
  environment[SYSTEM_TZ] = environment.TZ === undefined ? "unset" : `=${environment.TZ}`;
  environment.TZ = chosen;
  return () => systemTimezone;
}
