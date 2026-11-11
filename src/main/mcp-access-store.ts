import {
  type AgentAccessRole,
  DEFAULT_MCP_SERVER_ACCESS,
  type McpAccessLevel,
  type McpAccessSnapshot,
  type McpServerAccess,
  mcpAccessRank,
  parseSetMcpAccessInput,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const MCP_ACCESS_FILE = "openbot-mcp-access-v1.json";

/** What a damaged file gives each MCP server: no agent and no member, until an owner or admin sets it again. */
const CLOSED: McpServerAccess = { agents: [], everyone: "none", roles: {} };

function copyAccess(access: McpServerAccess): McpServerAccess {
  return {
    agents: access.agents === null ? null : [...access.agents],
    everyone: access.everyone,
    roles: { ...access.roles },
  };
}

/**
 * The level of `member` for an MCP server with `access`. Owners, admins, and the member who added the
 * server always manage. A member gets the highest of `everyone` and of each role that names the member.
 */
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

/**
 * What `member` reads for the MCP servers `mcpServerIds`. A member reads only `mine`, without the
 * servers that the member has `none` for. An owner or admin also reads the entry of each server.
 */
export function mcpAccessSnapshot(
  store: Pick<McpAccessStore, "get">,
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
  return member.role === "member" ? { mine } : { mine, servers };
}

/** The access entries as the IPC handlers and the Team API routes change them: a set also gives each agent a new provider session. */
export interface McpAccessControl {
  get(mcpServerId: string): McpServerAccess;
  set(
    mcpServerId: string,
    access: McpServerAccess,
    existing: ReadonlySet<string>,
  ): Effect.Effect<void, PreferenceFileFailure | AgentLifecycleFailed>;
  remove(mcpServerId: string): Effect.Effect<void, PreferenceFileFailure>;
}

function decodeServers(parsed: unknown): Map<string, McpServerAccess> | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.servers)) return null;
  const servers = new Map<string, McpServerAccess>();
  for (const [mcpServerId, access] of Object.entries(parsed.servers))
    servers.set(mcpServerId, parseSetMcpAccessInput({ mcpServerId, access }).access);
  return servers;
}

/**
 * Which agents get each MCP server of this host, and the level of each role for it (`mcp-access-v1`),
 * by MCP server ID. A preference file rather than the database: it needs no migration, and an older
 * build ignores it, so a downgrade keeps the entries.
 *
 * A server with no entry goes to each agent, and each member can use it. A missing file reads as no
 * entries. A file that does not decode closes each MCP server to agents and members, so it does not
 * open a server that an entry closed. The next save replaces it.
 */
export class McpAccessStore {
  readonly #path: string;
  #servers = new Map<string, McpServerAccess>();
  #closed = false;
  readonly #writes = Semaphore.makeUnsafe(1);

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

  get(mcpServerId: string): McpServerAccess {
    return copyAccess(this.#closed ? CLOSED : (this.#servers.get(mcpServerId) ?? DEFAULT_MCP_SERVER_ACCESS));
  }

  /** Whether the agent gets the MCP server. `null` is a session with no known agent: it gets only a server that each agent gets. */
  allowsAgent(mcpServerId: string, agentId: string | null): boolean {
    if (this.#closed) return false;
    const agents = this.#servers.get(mcpServerId)?.agents ?? null;
    return agents === null || (agentId !== null && agents.includes(agentId));
  }

  /**
   * Replaces the entry of one MCP server. `existing` names the MCP servers of the host: the entry of
   * a removed server goes, and after a damaged file each other server stays closed.
   */
  readonly set = Effect.fn("McpAccessStore.set")(function* (
    this: McpAccessStore,
    mcpServerId: string,
    access: McpServerAccess,
    existing: ReadonlySet<string>,
  ) {
    yield* this.#replace((servers) => {
      const next = new Map<string, McpServerAccess>();
      for (const id of existing) {
        const kept = this.#closed ? CLOSED : servers.get(id);
        if (kept) next.set(id, kept);
      }
      next.set(mcpServerId, copyAccess(access));
      return next;
    });
  }).bind(this);

  /** Drops the entry of a removed MCP server. */
  readonly remove = Effect.fn("McpAccessStore.remove")(function* (this: McpAccessStore, mcpServerId: string) {
    yield* this.#replace((servers) => {
      // A damaged file keeps each server closed; a write here would replace it.
      if (this.#closed || !servers.has(mcpServerId)) return null;
      const next = new Map(servers);
      next.delete(mcpServerId);
      return next;
    });
  }).bind(this);

  /** `next` answers null when there is nothing to write. */
  #replace(
    next: (servers: ReadonlyMap<string, McpServerAccess>) => Map<string, McpServerAccess> | null,
  ): Effect.Effect<void, PreferenceFileFailure> {
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const servers = next(this.#servers);
          if (!servers) return;
          yield* writePreferenceFile(this.#path, { version: 1, servers: Object.fromEntries(servers) });
          this.#servers = servers;
          this.#closed = false;
        }),
      ),
    );
  }
}
