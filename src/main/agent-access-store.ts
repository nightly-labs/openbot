import {
  type AgentAccessChange,
  type AgentAccessLevel,
  type AgentAccessLevels,
  type AgentAccessRole,
  type AgentAccessSnapshot,
  agentAccessRank,
  parseAgentAccessChange,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect, Result, Schema, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const AGENT_ACCESS_FILE = "openbot-agent-access-v1.json";

/** The roles of one server, as the host stores them. */
export interface AgentAccessState {
  revision: number;
  everyone: AgentAccessLevels;
  roles: AgentAccessRole[];
}

/** A replace that named a revision other than the stored one: another admin saved first. */
export class AgentAccessStale extends Schema.TaggedError<AgentAccessStale>()("AgentAccessStale", {}) {}

const EMPTY: AgentAccessState = { revision: 0, everyone: {}, roles: [] };

/**
 * The level of `member` for `agentId`. Owners and admins always manage. A member gets the highest
 * of "everyone" (`manage` for an agent that it does not list) and of each role that names the member
 * (`none` for an agent that the role does not list).
 */
export function agentAccessLevel(
  state: AgentAccessState | "closed",
  member: Pick<TeamMemberSummary, "id" | "role">,
  agentId: string,
): AgentAccessLevel {
  if (member.role !== "member") return "manage";
  if (state === "closed") return "none";
  let level: AgentAccessLevel = state.everyone[agentId] ?? "manage";
  for (const role of state.roles) {
    if (level === "manage") break;
    if (!role.memberIds.includes(member.id)) continue;
    const granted = role.agents[agentId];
    if (granted && agentAccessRank(granted) > agentAccessRank(level)) level = granted;
  }
  return level;
}

/**
 * What `member` reads. `shown` names the agents that the caller can see, in their order; the
 * levels of other agents stay on the host. A member reads only `mine`.
 */
export function agentAccessSnapshot(
  state: AgentAccessState | "closed",
  member: Pick<TeamMemberSummary, "id" | "role">,
  shown: readonly string[],
): AgentAccessSnapshot {
  const mine: AgentAccessLevels = {};
  for (const agentId of shown) {
    const level = agentAccessLevel(state, member, agentId);
    if (level !== "none") mine[agentId] = level;
  }
  const stored = state === "closed" ? EMPTY : state;
  if (member.role === "member") return { revision: stored.revision, mine };
  const visible = new Set(shown);
  const only = (levels: AgentAccessLevels) =>
    Object.fromEntries(Object.entries(levels).filter(([agentId]) => visible.has(agentId)));
  return {
    revision: stored.revision,
    mine,
    everyone: only(stored.everyone),
    roles: stored.roles.map((role) => ({ ...role, agents: only(role.agents), memberIds: [...role.memberIds] })),
  };
}

// An admin replaces the levels of the agents that they see. The levels of an agent that their client
// cannot show, or that has not loaded yet, stay as they were. The levels of a deleted agent go.
function mergeShown(
  stored: AgentAccessLevels,
  sent: AgentAccessLevels,
  shown: ReadonlySet<string>,
  existing: ReadonlySet<string>,
) {
  const merged: AgentAccessLevels = Object.fromEntries(
    Object.entries(stored).filter(([agentId]) => !shown.has(agentId) && existing.has(agentId)),
  );
  for (const [agentId, level] of Object.entries(sent)) if (shown.has(agentId)) merged[agentId] = level;
  return merged;
}

function copyState(state: AgentAccessState): AgentAccessState {
  return {
    revision: state.revision,
    everyone: { ...state.everyone },
    roles: state.roles.map((role) => ({ ...role, agents: { ...role.agents }, memberIds: [...role.memberIds] })),
  };
}

function decodeServers(parsed: unknown): Map<string, AgentAccessState> | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.servers)) return null;
  const servers = new Map<string, AgentAccessState>();
  for (const [serverId, value] of Object.entries(parsed.servers)) {
    if (!isDynamicRecord(value) || !isNumber(value.revision)) return null;
    const { everyone, roles } = parseAgentAccessChange({
      revision: value.revision,
      everyone: value.everyone,
      roles: value.roles,
    });
    servers.set(serverId, { revision: value.revision, everyone, roles });
  }
  return servers;
}

/**
 * The roles of each server that this computer hosts, by server ID. A preference file rather than the
 * database: it needs no migration, and an older build ignores it, so a downgrade keeps the roles.
 *
 * A missing file reads as no roles. A file that does not decode closes every agent to members, so it
 * does not open agents that its roles closed. The next save replaces it.
 */
export class AgentAccessStore {
  readonly #path: string;
  #servers = new Map<string, AgentAccessState>();
  #closed = false;
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(serverId: string, state: AgentAccessState) => void>();

  constructor(path: string) {
    this.#path = path;
  }

  /** Returns false when the file exists and does not decode. */
  load(): Effect.Effect<boolean, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeServers));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#servers = loaded.success;
        this.#closed = loaded.success === null;
        return !this.#closed;
      }
      if (isMissingFileError(loaded.failure.cause)) return true;
      this.#closed = true;
      return false;
    });
  }

  get(serverId: string): AgentAccessState {
    return copyState(this.#closed ? EMPTY : (this.#servers.get(serverId) ?? EMPTY));
  }

  /** `closed` when a damaged file must keep members out. */
  levels(serverId: string): AgentAccessState | "closed" {
    return this.#closed ? "closed" : (this.#servers.get(serverId) ?? EMPTY);
  }

  /**
   * Replaces the roles. `shown` names the agents that the caller can see, and `existing` all agents of
   * the host; see `mergeShown`.
   */
  readonly set = Effect.fn("AgentAccessStore.set")(function* (
    this: AgentAccessStore,
    serverId: string,
    change: AgentAccessChange,
    shown: ReadonlySet<string>,
    existing: ReadonlySet<string>,
  ) {
    return yield* this.#replace(serverId, (current) => {
      if (change.revision !== current.revision) return null;
      const storedRoles = new Map(current.roles.map((role) => [role.id, role]));
      return {
        everyone: mergeShown(current.everyone, change.everyone, shown, existing),
        roles: change.roles.map((role) => ({
          ...role,
          agents: mergeShown(storedRoles.get(role.id)?.agents ?? {}, role.agents, shown, existing),
        })),
      };
    });
  }).bind(this);

  /** Takes a removed member out of each role. */
  readonly removeMember = Effect.fn("AgentAccessStore.removeMember")(function* (
    this: AgentAccessStore,
    serverId: string,
    memberId: string,
  ) {
    yield* this.#replace(serverId, (state) =>
      state.roles.some((role) => role.memberIds.includes(memberId))
        ? {
            everyone: state.everyone,
            roles: state.roles.map((role) => ({
              ...role,
              memberIds: role.memberIds.filter((id) => id !== memberId),
            })),
          }
        : "unchanged",
    );
  }).bind(this);

  /**
   * Gives a duplicated agent the levels of its source, so that the copy, with its memories and routines,
   * is not open to members that the source was closed to.
   */
  readonly copyAgent = Effect.fn("AgentAccessStore.copyAgent")(function* (
    this: AgentAccessStore,
    serverId: string,
    sourceAgentId: string,
    agentId: string,
  ) {
    yield* this.#replace(serverId, (state) => {
      // A damaged file keeps members out of every agent; a write here would replace it.
      if (this.#closed) return "unchanged";
      const copy = (levels: AgentAccessLevels): AgentAccessLevels => {
        const level = levels[sourceAgentId];
        return level ? { ...levels, [agentId]: level } : levels;
      };
      const everyone = copy(state.everyone);
      const roles = state.roles.map((role) => ({ ...role, agents: copy(role.agents) }));
      const changed =
        everyone !== state.everyone || roles.some((role, index) => role.agents !== state.roles[index]?.agents);
      return changed ? { everyone, roles } : "unchanged";
    });
  }).bind(this);

  subscribe(listener: (serverId: string, state: AgentAccessState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #replace(
    serverId: string,
    // Null when the change is stale; "unchanged" when there is nothing to write.
    next: (current: AgentAccessState) => Omit<AgentAccessState, "revision"> | "unchanged" | null,
  ): Effect.Effect<AgentAccessState, PreferenceFileFailure | AgentAccessStale> {
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const current = this.#closed ? EMPTY : (this.#servers.get(serverId) ?? EMPTY);
          const replacement = next(current);
          if (!replacement) return yield* new AgentAccessStale();
          if (replacement === "unchanged") return copyState(current);
          const saved = copyState({ ...replacement, revision: current.revision + 1 });
          const servers = new Map(this.#closed ? [] : this.#servers);
          servers.set(serverId, saved);
          yield* writePreferenceFile(this.#path, { version: 1, servers: Object.fromEntries(servers) });
          this.#servers = servers;
          this.#closed = false;
          for (const listener of this.#listeners) listener(serverId, copyState(saved));
          return copyState(saved);
        }),
      ),
    );
  }
}
