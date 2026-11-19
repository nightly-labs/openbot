import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { HostAgentLimitSettings } from "@openbot/contracts/ipc";
import { hostAgentLimitSettings } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const HOST_AGENT_LIMIT_PREFERENCE_FILE = "openbot-host-agent-limit-v1.json";

export class HostAgentLimitPreferenceStore {
  readonly #path: string;
  #limit: number | null = null;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeHostAgentLimit));
      if (Result.isSuccess(loaded)) this.#limit = loaded.success;
      else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): HostAgentLimitSettings {
    return hostAgentLimitSettings(this.#limit);
  }

  effective(): number {
    return this.#limit ?? INPUT_LIMITS.agents;
  }

  readonly set = Effect.fn("HostAgentLimitPreference.set")((limit: number | null) =>
    this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, limit }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#limit = limit;
            }),
          ),
          Effect.map(() => this.get()),
        ),
      ),
    ),
  );
}

export function parseHostAgentLimit(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > INPUT_LIMITS.hostAgentLimitMax
  ) {
    throw new Error(sourceText("error.host.agentLimitInvalid"));
  }
  return value;
}

function isHostAgentLimitValue(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= INPUT_LIMITS.hostAgentLimitMax
  );
}

function decodeHostAgentLimit(parsed: unknown): number | null {
  if (isDynamicRecord(parsed) && parsed.version === 1 && (parsed.limit === null || isHostAgentLimitValue(parsed.limit)))
    return parsed.limit;
  return null;
}
