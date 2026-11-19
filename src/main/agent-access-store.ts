import {
  type AgentAccessChange,
  type AgentAccessLevel,
  type AgentAccessLevels,
  type AgentAccessRole,
  type AgentAccessSnapshot,
  agentAccessRank,
  parseAgentAccessChange,
  type ServerAuditName,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect, Result, Schema, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const AGENT_ACCESS_FILE = "openbot-agent-access-v1.json";

export interface AgentAccessState {
  revision: number;
  everyone: AgentAccessLevels;
  roles: AgentAccessRole[];
}

export type AgentAccessAudit = (
  serverId: string,
  before: AgentAccessState,
  after: AgentAccessState,
  actor: ServerAuditName | null,
) => Effect.Effect<void>;

export class AgentAccessStale extends Schema.TaggedError<AgentAccessStale>()("AgentAccessStale", {}) {}

const EMPTY: AgentAccessState = { revision: 0, everyone: {}, roles: [] };

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

function onlyAgents(state: AgentAccessState, agents: ReadonlySet<string>): AgentAccessState {
  const only = (levels: AgentAccessLevels) =>
    Object.fromEntries(Object.entries(levels).filter(([agentId]) => agents.has(agentId)));
  return {
    revision: state.revision,
    everyone: only(state.everyone),
    roles: state.roles.map((role) => ({ ...role, agents: only(role.agents), memberIds: [...role.memberIds] })),
  };
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

export class AgentAccessStore {
  readonly #path: string;
  #servers = new Map<string, AgentAccessState>();
  #closed = false;
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(serverId: string, state: AgentAccessState) => void>();
  readonly #audit: AgentAccessAudit | undefined;

  constructor(path: string, options: { audit?: AgentAccessAudit } = {}) {
    this.#path = path;
    this.#audit = options.audit;
  }

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

  levels(serverId: string): AgentAccessState | "closed" {
    return this.#closed ? "closed" : (this.#servers.get(serverId) ?? EMPTY);
  }

  readonly set = Effect.fn("AgentAccessStore.set")(function* (
    this: AgentAccessStore,
    serverId: string,
    change: AgentAccessChange,
    shown: ReadonlySet<string>,
    existing: ReadonlySet<string>,
    actor: ServerAuditName | null,
  ) {
    let before: AgentAccessState | undefined;
    const saved = yield* this.#replace(serverId, (current) => {
      before = copyState(current);
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
    if (before && this.#audit && saved.revision !== before.revision)
      yield* this.#audit(serverId, onlyAgents(before, existing), onlyAgents(saved, existing), actor);
    return saved;
  }).bind(this);

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

  readonly copyAgent = Effect.fn("AgentAccessStore.copyAgent")(function* (
    this: AgentAccessStore,
    serverId: string,
    sourceAgentId: string,
    agentId: string,
  ) {
    yield* this.#replace(serverId, (state) => {
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
