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

export const OWNER_NOTIFICATION_KEY = "owner";

interface MemberLevels {
  server: ServerNotificationLevel | null;
  agents: Readonly<Record<string, ServerNotificationLevel>>;
}

const NO_LEVELS: MemberLevels = { server: null, agents: {} };

export class AgentNotificationLevelStore {
  readonly #path: string;
  #members: Readonly<Record<string, MemberLevels>> = {};
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(key: string) => void>();

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

  subscribe(listener: (key: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  levels(key: string): ReadonlyMap<string, ServerNotificationLevel> {
    return new Map(Object.entries(this.#members[key]?.agents ?? {}));
  }

  serverLevel(key: string): ServerNotificationLevel | null {
    return this.#members[key]?.server ?? null;
  }

  snapshot(key: string, hidden: ReadonlySet<string> = new Set()): AgentNotificationLevelsSnapshot {
    return {
      server: this.serverLevel(key),
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
    yield* this.#update((members) => {
      const current = members[key] ?? NO_LEVELS;
      const agents = { ...current.agents };
      if (level === null) delete agents[agentId];
      else agents[agentId] = level;
      const kept = Object.fromEntries(Object.entries(agents).slice(-AGENT_NOTIFICATION_LEVEL_LIMIT));
      return { ...members, [key]: { server: current.server, agents: kept } };
    });
    this.#changed(key);
    return this.snapshot(key);
  });

  readonly setServer = Effect.fn("AgentNotificationLevels.setServer")(function* (
    this: AgentNotificationLevelStore,
    key: string,
    level: ServerNotificationLevel | null,
  ) {
    yield* this.#update((members) => ({
      ...members,
      [key]: { server: level, agents: (members[key] ?? NO_LEVELS).agents },
    }));
    this.#changed(key);
    return this.snapshot(key);
  });

  readonly removeMember = Effect.fn("AgentNotificationLevels.removeMember")(function* (
    this: AgentNotificationLevelStore,
    key: string,
  ) {
    yield* this.#update((members) => {
      if (!members[key]) return null;
      const { [key]: _removed, ...rest } = members;
      return rest;
    });
  });

  #changed(key: string): void {
    for (const listener of this.#listeners) listener(key);
  }

  #update(
    change: (members: Readonly<Record<string, MemberLevels>>) => Readonly<Record<string, MemberLevels>> | null,
  ): Effect.Effect<void, PreferenceFileFailure> {
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const members = change(this.#members);
          if (!members) return Effect.void;
          const kept = Object.fromEntries(
            Object.entries(members).filter(
              ([, levels]) => levels.server !== null || Object.keys(levels.agents).length > 0,
            ),
          );
          return writePreferenceFile(this.#path, { version: 2, members: kept }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.#members = kept;
              }),
            ),
          );
        }),
      ),
    );
  }
}

function decodeLevels(value: unknown): Record<string, ServerNotificationLevel> {
  return isDynamicRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, ServerNotificationLevel] =>
          isServerNotificationLevel(entry[1]),
        ),
      )
    : {};
}

function decodeFile(parsed: unknown): Record<string, MemberLevels> | null {
  if (!isDynamicRecord(parsed) || !isDynamicRecord(parsed.members)) return null;
  const version = parsed.version;
  if (version !== 1 && version !== 2) return null;
  return Object.fromEntries(
    Object.entries(parsed.members).flatMap(([key, value]): [string, MemberLevels][] => {
      if (!isDynamicRecord(value)) return [];
      if (version === 1) return [[key, { server: null, agents: decodeLevels(value) }]];
      return [
        [
          key,
          {
            server: isServerNotificationLevel(value.server) ? value.server : null,
            agents: decodeLevels(value.agents),
          },
        ],
      ];
    }),
  );
}
