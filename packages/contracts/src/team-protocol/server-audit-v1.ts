// Frozen optional server-audit-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a server
// reads the changes to the access of that server, newest first: members that joined, were removed or
// got another server role, roles that were made, renamed or deleted, members added to or removed from
// a role, and the level that a role or every member got for an agent. Each entry names the member who
// made the change (`actor`, null when the host does not know) and keeps the names of the time of the
// change, so a removed member or a deleted agent keeps its name. The host keeps the newest 500 entries
// of each server; the log has no other filter or page. A member cannot read it; `requireAdmin` on the
// host is the only gate. A client leaves out an entry whose `kind` it does not know, so a later kind
// needs no new capability. Widening any other part needs a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const SERVER_AUDIT_CAPABILITY = "server-audit-v1";

export const SERVER_AUDIT_ROUTES = {
  read: "/v1/admin/host/audit",
} as const;

const name = fields({ id: identifier, name: string(200) });
const memberRole = oneOf("admin", "member");
const level = oneOf("none", "view", "chat", "manage");
const kind = (value: string): AdminDecoder => oneOf(value);

const KNOWN_CHANGES = new Map<string, AdminDecoder>([
  ["member-joined", fields({ kind: kind("member-joined"), member: name, role: memberRole })],
  ["member-removed", fields({ kind: kind("member-removed"), member: name })],
  ["member-role", fields({ kind: kind("member-role"), member: name, from: memberRole, to: memberRole })],
  ["role-created", fields({ kind: kind("role-created"), role: name })],
  ["role-renamed", fields({ kind: kind("role-renamed"), roleId: identifier, from: string(200), to: string(200) })],
  ["role-deleted", fields({ kind: kind("role-deleted"), role: name })],
  ["role-member", fields({ kind: kind("role-member"), role: name, member: name, added: boolean })],
  ["agent-level", fields({ kind: kind("agent-level"), role: nullable(name), agent: name, from: level, to: level })],
]);

// A kind that this contract does not list keeps only its kind; the client leaves the entry out.
const change: AdminDecoder = (value) => {
  if (!isDynamicRecord(value) || !isString(value.kind) || !value.kind.length || value.kind.length > 64)
    throw new Error("Invalid admin variant.");
  const decode = KNOWN_CHANGES.get(value.kind);
  return decode ? decode(value) : { kind: value.kind };
};

const entry = fields({ id: identifier, at: string(40), actor: nullable(name), change });

export const SERVER_AUDIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SERVER_AUDIT_ROUTES.read, adminRoute(empty, fields({ entries: list(entry, 500) }))],
]);
