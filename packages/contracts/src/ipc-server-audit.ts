import {
  AGENT_ACCESS_LEVELS,
  type AgentAccessLevel,
  type AgentAccessLevels,
  type AgentAccessRole,
} from "./ipc-agent-access";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const SERVER_AUDIT_ENTRY_LIMIT = 500;
const NAME_LIMIT = 200;
const TIME_LIMIT = 40;

export const SERVER_AUDIT_MEMBER_ROLES = ["admin", "member"] as const;
export type ServerAuditMemberRole = (typeof SERVER_AUDIT_MEMBER_ROLES)[number];

export interface ServerAuditName {
  id: string;
  name: string;
}

export type ServerAuditChange =
  | { kind: "member-joined"; member: ServerAuditName; role: ServerAuditMemberRole }
  | { kind: "member-removed"; member: ServerAuditName }
  | { kind: "member-role"; member: ServerAuditName; from: ServerAuditMemberRole; to: ServerAuditMemberRole }
  | { kind: "role-created"; role: ServerAuditName }
  | { kind: "role-renamed"; roleId: string; from: string; to: string }
  | { kind: "role-deleted"; role: ServerAuditName }
  | { kind: "role-member"; role: ServerAuditName; member: ServerAuditName; added: boolean }
  | {
      kind: "agent-level";
      role: ServerAuditName | null;
      agent: ServerAuditName;
      from: AgentAccessLevel;
      to: AgentAccessLevel;
    };

export type ServerAuditChangeKind = ServerAuditChange["kind"];

export interface ServerAuditEntry {
  id: string;
  at: string;
  actor: ServerAuditName | null;
  change: ServerAuditChange;
}

export interface ServerAuditLog {
  entries: ServerAuditEntry[];
}

function serverAuditText(name: string): string {
  if (name.length <= NAME_LIMIT) return name;
  let cut = "";
  for (const character of name) {
    if (cut.length + character.length > NAME_LIMIT) break;
    cut += character;
  }
  return cut;
}

export function serverAuditName(id: string, name: string): ServerAuditName {
  return { id, name: serverAuditText(name) };
}

function isName(value: unknown): value is ServerAuditName {
  return isDynamicRecord(value) && isIdentifier(value.id) && isBoundedString(value.name, NAME_LIMIT);
}

function copyName(name: ServerAuditName): ServerAuditName {
  return { id: name.id, name: name.name };
}

const isMemberRole = (value: unknown): value is ServerAuditMemberRole => isOneOf(SERVER_AUDIT_MEMBER_ROLES, value);
const isLevel = (value: unknown): value is AgentAccessLevel => isOneOf(AGENT_ACCESS_LEVELS, value);

function decodeChange(value: unknown): ServerAuditChange | null {
  if (!isDynamicRecord(value)) throw new Error("Invalid server audit change.");
  switch (value.kind) {
    case "member-joined":
      if (isName(value.member) && isMemberRole(value.role))
        return { kind: value.kind, member: copyName(value.member), role: value.role };
      break;
    case "member-removed":
      if (isName(value.member)) return { kind: value.kind, member: copyName(value.member) };
      break;
    case "member-role":
      if (isName(value.member) && isMemberRole(value.from) && isMemberRole(value.to))
        return { kind: value.kind, member: copyName(value.member), from: value.from, to: value.to };
      break;
    case "role-created":
    case "role-deleted":
      if (isName(value.role)) return { kind: value.kind, role: copyName(value.role) };
      break;
    case "role-renamed":
      if (
        isIdentifier(value.roleId) &&
        isBoundedString(value.from, NAME_LIMIT) &&
        isBoundedString(value.to, NAME_LIMIT)
      )
        return { kind: value.kind, roleId: value.roleId, from: value.from, to: value.to };
      break;
    case "role-member":
      if (isName(value.role) && isName(value.member) && typeof value.added === "boolean")
        return { kind: value.kind, role: copyName(value.role), member: copyName(value.member), added: value.added };
      break;
    case "agent-level":
      if (
        (value.role === null || isName(value.role)) &&
        isName(value.agent) &&
        isLevel(value.from) &&
        isLevel(value.to)
      )
        return {
          kind: value.kind,
          role: value.role === null ? null : copyName(value.role),
          agent: copyName(value.agent),
          from: value.from,
          to: value.to,
        };
      break;
    default:
      if (typeof value.kind === "string") return null;
  }
  throw new Error("Invalid server audit change.");
}

export function decodeServerAuditLog(value: unknown): ServerAuditLog {
  if (!isDynamicRecord(value) || !Array.isArray(value.entries) || value.entries.length > SERVER_AUDIT_ENTRY_LIMIT)
    throw new Error("Invalid server audit log.");
  const entries: ServerAuditEntry[] = [];
  for (const entry of value.entries) {
    if (
      !isDynamicRecord(entry) ||
      !isIdentifier(entry.id) ||
      !isBoundedString(entry.at, TIME_LIMIT) ||
      Number.isNaN(Date.parse(entry.at)) ||
      (entry.actor !== null && !isName(entry.actor))
    )
      throw new Error("Invalid server audit log.");
    const change = decodeChange(entry.change);
    if (!change) continue;
    entries.push({ id: entry.id, at: entry.at, actor: entry.actor === null ? null : copyName(entry.actor), change });
  }
  return { entries };
}

export interface ServerAuditNames {
  member(id: string): string;
  agent(id: string): string;
}

export interface AgentAccessRoles {
  everyone: AgentAccessLevels;
  roles: readonly AgentAccessRole[];
}

export function agentAccessAuditChanges(
  before: AgentAccessRoles,
  after: AgentAccessRoles,
  names: ServerAuditNames,
): ServerAuditChange[] {
  const member = (id: string) => serverAuditName(id, names.member(id));
  const agent = (id: string) => serverAuditName(id, names.agent(id));
  const roleName = (role: AgentAccessRole) => serverAuditName(role.id, role.name);
  const previous = new Map(before.roles.map((role) => [role.id, role]));
  const next = new Set(after.roles.map((role) => role.id));
  const named: ServerAuditChange[] = [];
  const members: ServerAuditChange[] = [];
  const levels: ServerAuditChange[] = [];
  const levelChanges = (
    role: ServerAuditName | null,
    from: AgentAccessLevels,
    to: AgentAccessLevels,
    unlisted: AgentAccessLevel,
  ) => {
    for (const agentId of new Set([...Object.keys(from), ...Object.keys(to)])) {
      const old = from[agentId] ?? unlisted;
      const level = to[agentId] ?? unlisted;
      if (old !== level) levels.push({ kind: "agent-level", role, agent: agent(agentId), from: old, to: level });
    }
  };
  levelChanges(null, before.everyone, after.everyone, "manage");
  for (const role of after.roles) {
    const old = previous.get(role.id);
    if (!old) named.push({ kind: "role-created", role: roleName(role) });
    else if (old.name !== role.name)
      named.push({
        kind: "role-renamed",
        roleId: role.id,
        from: serverAuditText(old.name),
        to: serverAuditText(role.name),
      });
    const oldMembers = new Set(old?.memberIds ?? []);
    const newMembers = new Set(role.memberIds);
    for (const id of newMembers)
      if (!oldMembers.has(id))
        members.push({ kind: "role-member", role: roleName(role), member: member(id), added: true });
    for (const id of oldMembers)
      if (!newMembers.has(id))
        members.push({ kind: "role-member", role: roleName(role), member: member(id), added: false });
    levelChanges(roleName(role), old?.agents ?? {}, role.agents, "none");
  }
  const deleted: ServerAuditChange[] = before.roles
    .filter((role) => !next.has(role.id))
    .map((role) => ({ kind: "role-deleted", role: roleName(role) }));
  return [...named, ...members, ...levels, ...deleted];
}
