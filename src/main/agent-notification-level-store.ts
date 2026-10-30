import {
  AGENT_NOTIFICATION_LEVEL_LIMIT,
  type AgentNotificationLevelsSnapshot,
  isServerNotificationLevel,
  type ServerNotificationLevel,
  type SetAgentNotificationLevelInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The person who uses this computer. The owner's desktop app has no member ID before the host first
 * runs, so the owner's levels have this key, and the owner's phones read the same levels.
 */
export const OWNER_NOTIFICATION_KEY = "owner";

type Levels = Readonly<Record<string, ServerNotificationLevel>>;

/**
 * The notification level that each person chose for each agent: the owner of this computer, and each
 * member of its server by member ID. A level replaces the server level for that agent on each device
 * of that person, and the host applies it to the notifications that it sends to their phones.
 *
 * A file that is missing or unreadable as JSON reads as no levels, and an entry that is not a level
 * is left out. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class AgentNotificationLevelStore {
  readonly #path: string;
  #members: Readonly<Record<string, Levels>> = {};
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeFile));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#members = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  /** The levels of one person, by agent. */
  levels(key: string): ReadonlyMap<string, ServerNotificationLevel> {
    return new Map(Object.entries(this.#members[key] ?? {}));
  }

  /** The levels of one person, without the agents in `hidden`, which that person cannot see. */
  snapshot(key: string, hidden: ReadonlySet<string> = new Set()): AgentNotificationLevelsSnapshot {
    return {
      agents: [...this.levels(key)]
        .filter(([agentId]) => !hidden.has(agentId))
        .map(([agentId, level]) => ({ agentId, level })),
    };
  }

  readonly set = Effect.fn("AgentNotificationLevels.set")(function* (
    this: AgentNotificationLevelStore,
    key: string,
    { agentId, level }: SetAgentNotificationLevelInput,
  ) {
    const current = { ...this.#members[key] };
    if (level === null) delete current[agentId];
    else current[agentId] = level;
    // The oldest choices go first. A person cannot see this many agents at once.
    const entries = Object.entries(current).slice(-AGENT_NOTIFICATION_LEVEL_LIMIT);
    yield* this.#write({ ...this.#members, [key]: Object.fromEntries(entries) });
    return this.snapshot(key);
  });

  /** A removed member keeps no choices on this computer. */
  readonly removeMember = Effect.fn("AgentNotificationLevels.removeMember")(function* (
    this: AgentNotificationLevelStore,
    key: string,
  ) {
    if (!this.#members[key]) return;
    const { [key]: _removed, ...rest } = this.#members;
    yield* this.#write(rest);
  });

  #write(members: Readonly<Record<string, Levels>>): Effect.Effect<void, PreferenceFileFailure> {
    // A person with no levels left has no entry.
    const kept = Object.fromEntries(Object.entries(members).filter(([, levels]) => Object.keys(levels).length > 0));
    return this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, members: kept }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#members = kept;
            }),
          ),
        ),
      ),
    );
  }
}

function decodeFile(parsed: unknown): Record<string, Levels> | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.members)) return null;
  return Object.fromEntries(
    Object.entries(parsed.members).flatMap(([key, levels]) =>
      isDynamicRecord(levels)
        ? [
            [
              key,
              Object.fromEntries(
                Object.entries(levels).filter((entry): entry is [string, ServerNotificationLevel] =>
                  isServerNotificationLevel(entry[1]),
                ),
              ),
            ],
          ]
        : [],
    ),
  );
}
