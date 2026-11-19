import { randomUUID } from "node:crypto";
import {
  type AgentAccessRoles,
  type AgentSummary,
  agentAccessAuditChanges,
  decodeServerAuditLog,
  SERVER_AUDIT_ENTRY_LIMIT,
  type ServerAuditChange,
  type ServerAuditEntry,
  type ServerAuditLog,
  type ServerAuditName,
  type ServerAuditNames,
  serverAuditName,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const SERVER_AUDIT_FILE = "openbot-server-audit-v1.json";

const logger = createOpenBotLogger("server-audit");

export function memberAuditName(member: Pick<TeamMemberSummary, "id" | "name" | "username">): ServerAuditName {
  return serverAuditName(member.id, member.name?.trim() || member.username);
}

type AuditMember = Pick<TeamMemberSummary, "id" | "name" | "username" | "role" | "disabled" | "createdAt">;

export interface TimedServerAuditChange {
  change: ServerAuditChange;
  at?: Date;
}

export function memberAuditChanges(
  before: readonly AuditMember[],
  after: readonly AuditMember[],
): TimedServerAuditChange[] {
  const present = (members: readonly AuditMember[]) =>
    new Map(members.filter((member) => !member.disabled).map((member) => [member.id, member]));
  const known = new Set(before.map((member) => member.id));
  const old = present(before);
  const next = present(after);
  const changes: TimedServerAuditChange[] = [];
  for (const member of next.values()) {
    if (member.role === "owner") continue;
    const previous = old.get(member.id);
    if (!previous) {
      const at = new Date(member.createdAt);
      changes.push({
        change: { kind: "member-joined", member: memberAuditName(member), role: member.role },
        ...(known.has(member.id) || Number.isNaN(at.getTime()) ? {} : { at }),
      });
    } else if (previous.role !== "owner" && previous.role !== member.role)
      changes.push({
        change: { kind: "member-role", member: memberAuditName(member), from: previous.role, to: member.role },
      });
  }
  for (const member of old.values())
    if (member.role !== "owner" && !next.has(member.id))
      changes.push({ change: { kind: "member-removed", member: memberAuditName(member) } });
  return changes;
}

export function serverAuditNames(
  members: readonly Pick<TeamMemberSummary, "id" | "name" | "username">[],
  agents: readonly Pick<AgentSummary, "id" | "name">[],
): ServerAuditNames {
  const memberNames = new Map(members.map((member) => [member.id, memberAuditName(member).name]));
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  return {
    member: (id) => memberNames.get(id) ?? id,
    agent: (id) => agentNames.get(id) ?? id,
  };
}

function decodeEntries(value: unknown): ServerAuditEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ServerAuditEntry[] = [];
  for (const entry of value.slice(0, SERVER_AUDIT_ENTRY_LIMIT)) {
    try {
      entries.push(...decodeServerAuditLog({ entries: [entry] }).entries);
    } catch {}
  }
  return entries;
}

function decodeServers(parsed: unknown): Map<string, ServerAuditEntry[]> | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.servers)) return null;
  const servers = new Map<string, ServerAuditEntry[]>();
  for (const [serverId, value] of Object.entries(parsed.servers)) servers.set(serverId, decodeEntries(value));
  return servers;
}

export class ServerAuditStore {
  readonly #path: string;
  #servers = new Map<string, ServerAuditEntry[]>();
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeServers));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#servers = loaded.success;
        else logger.warn("The server audit log did not decode; it starts empty.");
        return;
      }
      if (!isMissingFileError(loaded.failure.cause))
        logger.warn("The server audit log did not load; it starts empty.", toLogValue(loaded.failure));
    });
  }

  recordAgentAccess(
    serverId: string,
    actor: ServerAuditName | null,
    before: AgentAccessRoles,
    after: AgentAccessRoles,
    names: () => ServerAuditNames,
  ): Effect.Effect<void> {
    return Effect.try(() => agentAccessAuditChanges(before, after, names()).map((change) => ({ change }))).pipe(
      Effect.flatMap((changes) => this.record(serverId, actor, changes)),
      Effect.catch((error) =>
        Effect.sync(() => logger.warn("The server audit log did not record a change.", toLogValue(error))),
      ),
    );
  }

  read(serverId: string): ServerAuditLog {
    return { entries: structuredClone(this.#servers.get(serverId) ?? []) };
  }

  record(
    serverId: string,
    actor: ServerAuditName | null,
    changes: readonly TimedServerAuditChange[],
  ): Effect.Effect<void> {
    if (changes.length === 0) return Effect.void;
    const now = new Date();
    const added = changes
      .map(({ change, at }): ServerAuditEntry => ({ id: randomUUID(), at: (at ?? now).toISOString(), actor, change }))
      .reverse();
    return this.#writes
      .withPermit(
        Effect.uninterruptible(
          Effect.gen({ self: this }, function* () {
            const entries = [...added, ...(this.#servers.get(serverId) ?? [])]
              .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
              .slice(0, SERVER_AUDIT_ENTRY_LIMIT);
            const servers = new Map(this.#servers);
            servers.set(serverId, entries);
            yield* writePreferenceFile(this.#path, { version: 1, servers: Object.fromEntries(servers) });
            this.#servers = servers;
          }),
        ),
      )
      .pipe(
        Effect.catch((error: PreferenceFileFailure) =>
          Effect.sync(() => logger.warn("The server audit log did not save.", toLogValue(error))),
        ),
      );
  }
}
