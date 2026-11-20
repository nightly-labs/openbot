import {
  type AgentAccessRole,
  copyMcpServerAccess,
  DEFAULT_MCP_SERVER_ACCESS,
  type McpAccessLevel,
  type McpAccessSnapshot,
  type McpServerAccess,
  mcpAccessRank,
  parseSetMcpAccessInput,
  type SetMcpAccessInput,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect, Result, Schema, Semaphore } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const MCP_ACCESS_FILE = "openbot-mcp-access-v1.json";

const CLOSED: McpServerAccess = { agents: [], everyone: "none", roles: {} };

class McpAccessStale extends Schema.TaggedError<McpAccessStale>()("McpAccessStale", {}) {}

export function sameMcpAgents(left: McpServerAccess["agents"], right: McpServerAccess["agents"]): boolean {
  if (left === null || right === null) return left === right;
  const agents = new Set(left);
  return agents.size === new Set(right).size && right.every((agentId) => agents.has(agentId));
}

export function mcpAccessLevel(
  access: McpServerAccess,
  member: Pick<TeamMemberSummary, "id" | "role">,
  roles: readonly AgentAccessRole[],
  added: boolean,
): McpAccessLevel {
  if (member.role !== "member" || added) return "manage";
  let level = access.everyone;
  for (const role of roles) {
    if (level === "manage") break;
    if (!role.memberIds.includes(member.id)) continue;
    const granted = access.roles[role.id];
    if (granted && mcpAccessRank(granted) > mcpAccessRank(level)) level = granted;
  }
  return level;
}

export function mcpAccessSnapshot(
  store: Pick<McpAccessStore, "get" | "revision">,
  mcpServerIds: readonly string[],
  member: Pick<TeamMemberSummary, "id" | "role">,
  roles: readonly AgentAccessRole[],
  added: (mcpServerId: string) => boolean,
): McpAccessSnapshot {
  const mine: Record<string, McpAccessLevel> = {};
  const servers: Record<string, McpServerAccess> = {};
  for (const mcpServerId of mcpServerIds) {
    const access = store.get(mcpServerId);
    const level = mcpAccessLevel(access, member, roles, added(mcpServerId));
    if (level !== "none") mine[mcpServerId] = level;
    servers[mcpServerId] = access;
  }
  const revision = store.revision();
  return member.role === "member" ? { revision, mine } : { revision, mine, servers };
}

export interface McpAccessControl {
  revision(): number;
  get(mcpServerId: string): McpServerAccess;
  set(
    change: SetMcpAccessInput,
    existing: ReadonlySet<string>,
  ): Effect.Effect<void, McpAccessStale | PreferenceFileFailure | AgentLifecycleFailed>;
  remove(mcpServerId: string): Effect.Effect<void, PreferenceFileFailure>;
}

interface StoredAccess {
  revision: number;
  servers: Map<string, McpServerAccess>;
}

function decodeStored(parsed: unknown): StoredAccess | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.servers)) return null;
  const revision = parsed.revision;
  if (!isNumber(revision)) return null;
  const servers = new Map<string, McpServerAccess>();
  for (const [mcpServerId, access] of Object.entries(parsed.servers))
    servers.set(mcpServerId, parseSetMcpAccessInput({ revision, mcpServerId, access }).access);
  return { revision, servers };
}

export class McpAccessStore {
  readonly #path: string;
  #servers = new Map<string, McpServerAccess>();
  #revision = 0;
  #closed = false;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<boolean, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeStored));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) {
          this.#servers = loaded.success.servers;
          this.#revision = loaded.success.revision;
        }
        this.#closed = loaded.success === null;
        return !this.#closed;
      }
      if (isMissingFileError(loaded.failure.cause)) return true;
      this.#closed = true;
      return false;
    });
  }

  revision(): number {
    return this.#revision;
  }

  get(mcpServerId: string): McpServerAccess {
    return copyMcpServerAccess(this.#closed ? CLOSED : (this.#servers.get(mcpServerId) ?? DEFAULT_MCP_SERVER_ACCESS));
  }

  allowsAgent(mcpServerId: string, agentId: string | null): boolean {
    if (this.#closed) return false;
    const agents = this.#servers.get(mcpServerId)?.agents ?? null;
    return agents === null || (agentId !== null && agents.includes(agentId));
  }

  readonly set = Effect.fn("McpAccessStore.set")(function* (
    this: McpAccessStore,
    change: SetMcpAccessInput,
    existing: ReadonlySet<string>,
  ) {
    const saved = yield* this.#replace((servers) => {
      if (change.revision !== this.#revision) return null;
      const next = new Map<string, McpServerAccess>();
      for (const id of existing) {
        const kept = this.#closed ? CLOSED : servers.get(id);
        if (kept) next.set(id, kept);
      }
      next.set(change.mcpServerId, copyMcpServerAccess(change.access));
      return next;
    }, 1);
    if (!saved) return yield* new McpAccessStale();
  }).bind(this);

  readonly remove = Effect.fn("McpAccessStore.remove")(function* (this: McpAccessStore, mcpServerId: string) {
    yield* this.#replace((servers) => {
      if (this.#closed || !servers.has(mcpServerId)) return null;
      const next = new Map(servers);
      next.delete(mcpServerId);
      return next;
    }, 0);
  }).bind(this);

  #replace(
    next: (servers: ReadonlyMap<string, McpServerAccess>) => Map<string, McpServerAccess> | null,
    step: 0 | 1,
  ): Effect.Effect<boolean, PreferenceFileFailure> {
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const servers = next(this.#servers);
          if (!servers) return false;
          const revision = this.#revision + step;
          yield* writePreferenceFile(this.#path, { version: 1, revision, servers: Object.fromEntries(servers) });
          this.#servers = servers;
          this.#revision = revision;
          this.#closed = false;
          return true;
        }),
      ),
    );
  }
}
